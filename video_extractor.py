import mimetypes
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

import yt_dlp
from google import genai
from google.genai import types
from pydantic import BaseModel, Field

from config import settings

PlaceCategory = Literal["food", "cafe", "bar", "nightlife", "attraction", "nature", "shopping", "accommodation", "activity", "other"]

# Videos up to this size are sent inline, bigger ones go through the Gemini Files API
INLINE_LIMIT_BYTES = 18 * 1024 * 1024

PROMPT = """You are helping a traveller turn a short travel post into trip plans.

The post is either a video or a photo slideshow. Watch the video and listen to the audio, or look at
the image. Use the speech, the on-screen text and the caption below to list every real place the post
recommends or shows that someone could visit, e.g. restaurants, cafes, attractions, shops, hotels or viewpoints.

Rules:
- Only include places that are actually named or clearly identifiable. Never invent places or addresses.
- Only use information from the post itself. Don't add facts from your own knowledge, even true ones,
  and don't attach a detail to a place unless the post links it to that place.
- Leave a field empty if the post doesn't say it.
- price_range is what the post says, e.g. "$$" or "¥1,200 per bowl".
- notes are short practical tips from the post, e.g. what to order, best time to go, whether to book.
- summary is one or two sentences describing the post.
- If the post doesn't mention any places, return an empty list.

Caption:
{caption}
"""

class Place(BaseModel):
    name: str = Field(description="Name of the place")
    category: PlaceCategory | None = None
    address: str | None = None
    city: str | None = None
    country: str | None = None
    price_range: str | None = None
    notes: str | None = None

class VideoExtraction(BaseModel):
    summary: str | None = None
    places: list[Place] = []

class ExtractionResult(BaseModel):
    caption: str | None = None
    summary: str | None = None
    places: list[Place] = []

class ExtractionError(Exception):
    """Raised with a message that is safe to show to users."""

@dataclass
class DownloadedPost:
    info: dict
    # Set for normal videos
    video_path: Path | None = None
    # Set for photo slideshows, which only have background music instead of a video
    cover_image: bytes | None = None

    @property
    def caption(self) -> str | None:
        return self.info.get("description") or self.info.get("title")

def normalise_url(url: str) -> str:
    """
    yt-dlp doesn't recognise TikTok photo links, but the same post id works as a video link.

    Args:
        url (str): The shared link.

    Returns:
        str: A link yt-dlp can handle.
    """
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()

    if (host == "tiktok.com" or host.endswith(".tiktok.com")) and "/photo/" in parsed.path:
        return parsed._replace(path=parsed.path.replace("/photo/", "/video/"), query="").geturl()

    return url

def has_video_stream(info: dict) -> bool:
    formats = info.get("formats") or [info]
    return any((f.get("vcodec") or "none") != "none" for f in formats)

def download_post(url: str, dest_dir: str) -> DownloadedPost:
    """
    Download a video, or the cover image of a photo slideshow, with yt-dlp.

    Args:
        url (str): The shared link.
        dest_dir (str): Directory to save the video in.

    Returns:
        DownloadedPost: The downloaded media and the post's metadata.
    """
    options = {
        "outtmpl": f"{dest_dir}/video.%(ext)s",
        # Prefer files that already contain audio and video so ffmpeg isn't needed to merge them
        "format": "best[ext=mp4][vcodec!=none][acodec!=none]/best[vcodec!=none][acodec!=none]/best",
        "max_filesize": settings.VIDEO_MAX_FILESIZE_MB * 1024 * 1024,
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
    }

    try:
        with yt_dlp.YoutubeDL(options) as ydl:
            info = ydl.extract_info(normalise_url(url), download=False)

            if not has_video_stream(info):
                # Slideshows only expose their background music, so use the cover slide instead.
                # The caption usually carries most of the details for these posts.
                cover_image = None
                if info.get("thumbnail"):
                    try:
                        cover_image = ydl.urlopen(info["thumbnail"]).read()
                    except Exception:
                        cover_image = None
                return DownloadedPost(info=info, cover_image=cover_image)

            duration = info.get("duration")
            if duration and duration > settings.VIDEO_MAX_DURATION_SECONDS:
                raise ExtractionError(f"Video is longer than {settings.VIDEO_MAX_DURATION_SECONDS // 60} minutes")

            ydl.process_ie_result(info, download=True)
    except yt_dlp.utils.DownloadError as e:
        raise ExtractionError("Could not download the post. It may be private or deleted.") from e

    files = [path for path in Path(dest_dir).glob("video.*") if not path.name.endswith(".part")]
    if not files:
        raise ExtractionError("Could not download the video. It may be too large.")

    return DownloadedPost(info=info, video_path=files[0])

def analyse_post(client: genai.Client, post: DownloadedPost) -> VideoExtraction:
    """
    Ask Gemini to pull the places out of a downloaded post.

    Args:
        client (genai.Client): The Gemini client.
        post (DownloadedPost): The downloaded video or cover image.

    Returns:
        VideoExtraction: The summary and places found in the post.
    """
    prompt = PROMPT.format(caption=post.caption or "(no caption)")
    contents = []
    uploaded = None

    try:
        if post.video_path is not None:
            mime_type = mimetypes.guess_type(post.video_path.name)[0] or "video/mp4"

            if post.video_path.stat().st_size <= INLINE_LIMIT_BYTES:
                contents.append(types.Part.from_bytes(data=post.video_path.read_bytes(), mime_type=mime_type))
            else:
                uploaded = client.files.upload(file=post.video_path, config={"mime_type": mime_type})

                # Large uploads are processed asynchronously by Gemini before they can be used
                while uploaded.state == types.FileState.PROCESSING:
                    time.sleep(2)
                    uploaded = client.files.get(name=uploaded.name)

                if uploaded.state == types.FileState.FAILED:
                    raise ExtractionError("The video could not be processed")

                contents.append(uploaded)
        elif post.cover_image is not None:
            contents.append(types.Part.from_bytes(data=post.cover_image, mime_type="image/jpeg"))
        elif not post.caption:
            raise ExtractionError("The post has no video, image or caption to read")

        contents.append(prompt)

        response = client.models.generate_content(
            model=settings.GEMINI_MODEL,
            contents=contents,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=VideoExtraction,
                temperature=0.2,
                automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
            ),
        )
    finally:
        if uploaded is not None:
            try:
                client.files.delete(name=uploaded.name)
            except Exception:
                # Gemini deletes uploaded files automatically after 48 hours anyway
                pass

    if isinstance(response.parsed, VideoExtraction):
        return response.parsed

    try:
        return VideoExtraction.model_validate_json(response.text or "")
    except ValueError as e:
        raise ExtractionError("Could not understand the post") from e

def extract_from_video(url: str) -> ExtractionResult:
    """
    Download a video or photo post and extract the places it mentions.

    Args:
        url (str): The shared TikTok, YouTube or Instagram link.

    Returns:
        ExtractionResult: The caption, summary and places.
    """
    if not settings.GEMINI_API_KEY:
        raise ExtractionError("Video extraction is not configured")

    client = genai.Client(api_key=settings.GEMINI_API_KEY)

    with tempfile.TemporaryDirectory(prefix="triplet-") as dest_dir:
        post = download_post(url, dest_dir)

        try:
            extraction = analyse_post(client, post)
        except ExtractionError:
            raise
        except Exception as e:
            # Quota errors, network problems, blocked content etc.
            raise ExtractionError("The AI service could not process this post") from e

    return ExtractionResult(
        caption=post.caption,
        summary=extraction.summary,
        places=extraction.places,
    )
