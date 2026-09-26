import mimetypes
import tempfile
import time
from pathlib import Path
from typing import Literal

import yt_dlp
from google import genai
from google.genai import types
from pydantic import BaseModel, Field

from config import settings

PlaceCategory = Literal["food", "cafe", "bar", "nightlife", "attraction", "nature", "shopping", "accommodation", "activity", "other"]

# Videos up to this size are sent inline, bigger ones go through the Gemini Files API
INLINE_LIMIT_BYTES = 18 * 1024 * 1024

PROMPT = """You are helping a traveller turn a short travel video into trip plans.

Watch the video and listen to the audio. Use the speech, the on-screen text and the caption below
to list every real place the video recommends or shows that someone could visit, e.g. restaurants,
cafes, attractions, shops, hotels or viewpoints.

Rules:
- Only include places that are actually named or clearly identifiable. Never invent places or addresses.
- Leave a field empty if the video doesn't say it.
- price_range is what the video says, e.g. "$$" or "¥1,200 per bowl".
- notes are short practical tips from the video, e.g. what to order, best time to go, whether to book.
- summary is one or two sentences describing the video.
- If the video doesn't mention any places, return an empty list.

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

def download_video(url: str, dest_dir: str) -> tuple[Path, dict]:
    """
    Download a video with yt-dlp.

    Args:
        url (str): The shared link.
        dest_dir (str): Directory to save the video in.

    Returns:
        tuple[Path, dict]: The downloaded file and the post's metadata.
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
            info = ydl.extract_info(url, download=False)

            duration = info.get("duration")
            if duration and duration > settings.VIDEO_MAX_DURATION_SECONDS:
                raise ExtractionError(f"Video is longer than {settings.VIDEO_MAX_DURATION_SECONDS // 60} minutes")

            ydl.process_ie_result(info, download=True)
    except yt_dlp.utils.DownloadError as e:
        raise ExtractionError("Could not download the video. It may be private or deleted.") from e

    files = [path for path in Path(dest_dir).glob("video.*") if not path.name.endswith(".part")]
    if not files:
        raise ExtractionError("Could not download the video. It may be too large.")

    return files[0], info

def analyse_video(client: genai.Client, video_path: Path, caption: str | None) -> VideoExtraction:
    """
    Ask Gemini to pull the places out of a downloaded video.

    Args:
        client (genai.Client): The Gemini client.
        video_path (Path): The downloaded video.
        caption (str | None): The post's caption, used as extra context.

    Returns:
        VideoExtraction: The summary and places found in the video.
    """
    mime_type = mimetypes.guess_type(video_path.name)[0] or "video/mp4"
    prompt = PROMPT.format(caption=caption or "(no caption)")
    uploaded = None

    try:
        if video_path.stat().st_size <= INLINE_LIMIT_BYTES:
            video = types.Part.from_bytes(data=video_path.read_bytes(), mime_type=mime_type)
        else:
            uploaded = client.files.upload(file=video_path, config={"mime_type": mime_type})

            # Large uploads are processed asynchronously by Gemini before they can be used
            while uploaded.state == types.FileState.PROCESSING:
                time.sleep(2)
                uploaded = client.files.get(name=uploaded.name)

            if uploaded.state == types.FileState.FAILED:
                raise ExtractionError("The video could not be processed")

            video = uploaded

        response = client.models.generate_content(
            model=settings.GEMINI_MODEL,
            contents=[video, prompt],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=VideoExtraction,
                temperature=0.2,
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
        raise ExtractionError("Could not understand the video") from e

def extract_from_video(url: str) -> ExtractionResult:
    """
    Download a video and extract the places it mentions.

    Args:
        url (str): The shared TikTok, YouTube or Instagram link.

    Returns:
        ExtractionResult: The caption, summary and places.
    """
    if not settings.GEMINI_API_KEY:
        raise ExtractionError("Video extraction is not configured")

    client = genai.Client(api_key=settings.GEMINI_API_KEY)

    with tempfile.TemporaryDirectory(prefix="triplet-") as dest_dir:
        video_path, info = download_video(url, dest_dir)
        caption = info.get("description") or info.get("title")

        try:
            extraction = analyse_video(client, video_path, caption)
        except ExtractionError:
            raise
        except Exception as e:
            # Quota errors, network problems, blocked content etc.
            raise ExtractionError("The AI service could not process this video") from e

    return ExtractionResult(
        caption=caption,
        summary=extraction.summary,
        places=extraction.places,
    )
