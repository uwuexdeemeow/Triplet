import logging
import mimetypes
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

import httpx
import yt_dlp
from google import genai
from google.genai import errors as genai_errors
from google.genai import types
from pydantic import BaseModel, Field

from config import settings

PlaceCategory = Literal["food", "cafe", "bar", "nightlife", "attraction", "nature", "shopping", "accommodation", "activity", "other"]

# Videos up to this size are sent inline, bigger ones go through the Gemini Files API
INLINE_LIMIT_BYTES = 18 * 1024 * 1024

# Rate limited, internal error or overloaded: worth waiting and trying again
RETRYABLE_CODES = {429, 500, 502, 503, 504}
RETRY_WAITS_SECONDS = [5, 20]

# Slideshow limits, keeping one Gemini request well under its 20 MB cap
MAX_SLIDES = 12
MAX_SLIDE_BYTES = 15 * 1024 * 1024

def image_mime_type(data: bytes) -> str:
    # TikTok serves slides as JPEG, WebP or HEIC; Gemini needs the right type
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[4:12] in (b"ftypheic", b"ftypheix", b"ftypmif1"):
        return "image/heic"
    return "image/jpeg"

logger = logging.getLogger("triplet.extractor")

PROMPT = """You are helping a traveller turn a short travel post into trip plans.

The post is a video, a photo slideshow, a screenshot, or a web article. Watch the video and listen to the
audio, look at every image in order, or read the article. Use the speech, the on-screen text and the caption or
article text below to list every real place the post recommends or shows that someone could visit, e.g.
restaurants, cafes, attractions, shops, hotels or viewpoints.

Rules:
- Only include places that are actually named or clearly identifiable. Never invent places or addresses.
- Only use information from the post itself. Don't add facts from your own knowledge, even true ones,
  and don't attach a detail to a place unless the post links it to that place.
- Leave a field empty if the post doesn't say it.
- price_range is what the post says, e.g. "$$" or "¥1,200 per bowl".
- notes are short practical tips from the post, e.g. what to order, best time to go, whether to book.
- hours_from_post is the opening hours exactly as the post states them, e.g. "11am - 9pm, closed Mondays".
- summary is one or two sentences describing the post.
- If the post doesn't mention any places, return an empty list.

Caption or article text:
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
    hours_from_post: str | None = Field(default=None, description="Opening hours, only if the post states them")

class VideoExtraction(BaseModel):
    summary: str | None = None
    places: list[Place] = []

class ExtractionResult(BaseModel):
    caption: str | None = None
    summary: str | None = None
    places: list[Place] = []
    # From the post's metadata, used when the platform's embed info didn't provide them
    author_name: str | None = None
    thumbnail_url: str | None = None

class ExtractionError(Exception):
    """Raised with a message that is safe to show to users."""

@dataclass
class DownloadedPost:
    info: dict
    # Set for normal videos
    video_path: Path | None = None
    # Set for YouTube, which Gemini watches from the link itself
    video_url: str | None = None
    # Set for photo slideshows, which only have background music instead of a video:
    # every slide when they could be fetched, otherwise just the cover
    images: list[bytes] = field(default_factory=list)

    @property
    def caption(self) -> str | None:
        return self.info.get("description") or self.info.get("title")

# TikTok's Share button copies short links like https://vt.tiktok.com/ZSb2Lx5Wx/
SHORT_LINK_HOSTS = {"vt.tiktok.com", "vm.tiktok.com"}

def expand_short_link(url: str) -> str:
    """
    Follow a TikTok short link to the post's full address, so photo posts can be recognised.

    Args:
        url (str): The shared link.

    Returns:
        str: The full address, or the original link if it isn't a short link or can't be resolved.
    """
    host = (urlparse(url).hostname or "").lower()
    is_short = host in SHORT_LINK_HOSTS or (host.endswith("tiktok.com") and urlparse(url).path.startswith("/t/"))
    if not is_short:
        return url

    try:
        # Imitate a browser, TikTok blocks plain HTTP clients
        from curl_cffi import requests as browser_requests
        response = browser_requests.head(url, impersonate="chrome", allow_redirects=True, timeout=15)
        return str(response.url) or url
    except Exception:
        logger.warning("Could not expand short link %s", url)
        return url

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

def download_slides(ydl: yt_dlp.YoutubeDL, info: dict) -> list[bytes]:
    """
    Download the images of a TikTok photo slideshow.

    yt-dlp only exposes a slideshow's music, but its TikTok extractor can fetch the post's page
    data (getting past TikTok's bot check), which lists every slide. That method is internal to
    yt-dlp, so any failure here falls back to the cover image instead of failing the extraction.

    Args:
        ydl (yt_dlp.YoutubeDL): The open downloader, which holds TikTok's cookies.
        info (dict): The post's metadata from yt-dlp.

    Returns:
        list[bytes]: The slides in order, or an empty list if they couldn't be fetched.
    """
    if info.get("extractor_key") != "TikTok":
        return []

    try:
        extractor = ydl.get_info_extractor("TikTok")
        page_data, _ = extractor._extract_web_data_and_status(info["webpage_url"], info["id"], fatal=False)
    except Exception:
        logger.warning("Could not read the slides of %s", info.get("webpage_url"), exc_info=True)
        return []

    slides = []
    total_bytes = 0
    for image in ((page_data or {}).get("imagePost") or {}).get("images") or []:
        urls = (image.get("imageURL") or {}).get("urlList") or []
        if not urls or len(slides) >= MAX_SLIDES:
            continue
        try:
            data = ydl.urlopen(urls[0]).read()
        except Exception:
            continue
        # Stay well under Gemini's limit for a single request
        if total_bytes + len(data) > MAX_SLIDE_BYTES:
            break
        slides.append(data)
        total_bytes += len(data)

    return slides

def download_covers(ydl: yt_dlp.YoutubeDL, entries: list[dict]) -> list[bytes]:
    """
    Download the cover image of each item in a carousel, like an Instagram post with several
    photos and clips. Photos are their own cover; for clips it's the first frame.
    """
    covers = []
    total_bytes = 0
    for entry in entries[:MAX_SLIDES]:
        url = entry.get("thumbnail") or next(
            (thumb.get("url") for thumb in reversed(entry.get("thumbnails") or []) if thumb.get("url")), None
        )
        if not url:
            continue
        try:
            data = ydl.urlopen(url).read()
        except Exception:
            continue
        if total_bytes + len(data) > MAX_SLIDE_BYTES:
            break
        covers.append(data)
        total_bytes += len(data)
    return covers

YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "music.youtube.com"}

def is_youtube(url: str) -> bool:
    return (urlparse(url).hostname or "").lower() in YOUTUBE_HOSTS

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
    started = time.monotonic()

    def give_up_if_slow(progress: dict):
        # yt-dlp has no overall time limit, only one per connection, so check as data arrives
        if time.monotonic() - started > settings.VIDEO_DOWNLOAD_TIMEOUT_SECONDS:
            raise ExtractionError("The video took too long to download. Try again later.")

    options = {
        "outtmpl": f"{dest_dir}/video.%(ext)s",
        "progress_hooks": [give_up_if_slow],
        # Seconds to wait for each connection before giving up
        "socket_timeout": 20,
        # Prefer files that already contain audio and video so ffmpeg isn't needed to merge them
        "format": "best[ext=mp4][vcodec!=none][acodec!=none]/best[vcodec!=none][acodec!=none]/best",
        "max_filesize": settings.VIDEO_MAX_FILESIZE_MB * 1024 * 1024,
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        # Instagram photo posts have no video at all; carry on and read their images instead
        "ignore_no_formats_error": True,
    }

    try:
        with yt_dlp.YoutubeDL(options) as ydl:
            if is_youtube(url):
                # YouTube only serves separate video and audio streams, which need ffmpeg to join.
                # Gemini can watch public YouTube videos by link, so just read the details here.
                info = ydl.extract_info(url, download=False, process=False)
                duration = info.get("duration")
                if duration and duration > settings.VIDEO_MAX_DURATION_SECONDS:
                    raise ExtractionError(f"Video is longer than {settings.VIDEO_MAX_DURATION_SECONDS // 60} minutes")
                if not info.get("thumbnail") and info.get("thumbnails"):
                    info["thumbnail"] = info["thumbnails"][-1].get("url")
                return DownloadedPost(info=info, video_url=f"https://www.youtube.com/watch?v={info['id']}")

            info = ydl.extract_info(normalise_url(expand_short_link(url)), download=False)

            if info.get("_type") == "playlist":
                # A carousel of photos and clips, like many Instagram posts
                entries = [entry for entry in info.get("entries") or [] if entry]
                if not info.get("thumbnail") and entries:
                    info["thumbnail"] = entries[0].get("thumbnail")
                return DownloadedPost(info=info, images=download_covers(ydl, entries))

            if not has_video_stream(info):
                # Slideshows only expose their background music, so read the slides instead.
                # Posts like "top 6 places in Japan" often only name the places on the slides.
                images = download_slides(ydl, info)
                if not images and info.get("thumbnail"):
                    try:
                        images = [ydl.urlopen(info["thumbnail"]).read()]
                    except Exception:
                        images = []
                return DownloadedPost(info=info, images=images)

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
        if post.video_url is not None:
            contents.append(types.Part(file_data=types.FileData(file_uri=post.video_url, mime_type="video/*")))
        elif post.video_path is not None:
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
        elif post.images:
            for image in post.images:
                contents.append(types.Part.from_bytes(data=image, mime_type=image_mime_type(image)))
        elif not post.caption:
            raise ExtractionError("The post has no video, image or caption to read")

        contents.append(prompt)

        response = _generate_with_retry(client, contents)
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

# Models that were overloaded or rate limited recently, and until when to try others first
BUSY_FOR_SECONDS = 120
_busy_until: dict[str, float] = {}

def _model_order() -> list[str]:
    """The models to try, in the configured order, but with recently busy ones last."""
    models = [settings.GEMINI_MODEL, *[m for m in settings.GEMINI_FALLBACK_MODELS if m != settings.GEMINI_MODEL]]
    now = time.monotonic()
    # Sorting is stable, so each group keeps the configured order
    return sorted(models, key=lambda model: _busy_until.get(model, 0) > now)

def _generate_with_retry(client: genai.Client, contents: list):
    """
    Call Gemini, switching models when one is busy or rate limited.

    A popular model sometimes answers 503 when overloaded, for minutes at a time, and the free tier
    limits requests per minute per model. Waiting rarely helps, so a busy model is skipped straight
    away for the next in GEMINI_FALLBACK_MODELS, and remembered as busy for a couple of minutes so
    the next posts start with one that's working. Only the last model left is retried after a wait.
    Other errors, like a blocked request, fail straight away.
    """
    models = _model_order()

    for model_index, model in enumerate(models):
        last_model = model_index == len(models) - 1
        waits = RETRY_WAITS_SECONDS if last_model else []

        for attempt, wait in enumerate([*waits, None]):
            try:
                response = client.models.generate_content(
                    model=model,
                    contents=contents,
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        response_schema=VideoExtraction,
                        temperature=0.2,
                        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
                    ),
                )
                _busy_until.pop(model, None)
                return response
            except httpx.TimeoutException:
                # Taking far longer than usual is a model under strain; don't wait on it again
                _busy_until[model] = time.monotonic() + BUSY_FOR_SECONDS
                if last_model:
                    raise
                logger.warning("Gemini model %s took over %ss, switching to %s",
                               model, settings.GEMINI_TIMEOUT_SECONDS, models[model_index + 1])
                break
            except genai_errors.APIError as e:
                # A missing model (404) is worth skipping too, e.g. an old name in .env
                if e.code not in RETRYABLE_CODES and not (e.code == 404 and not last_model):
                    raise
                if e.code in RETRYABLE_CODES:
                    _busy_until[model] = time.monotonic() + BUSY_FOR_SECONDS
                if wait is None or e.code == 404:
                    if last_model:
                        raise
                    logger.warning("Gemini model %s returned %s, switching to %s", model, e.code, models[model_index + 1])
                    break
                logger.warning("Gemini model %s returned %s, retrying in %ss (attempt %s)", model, e.code, wait, attempt + 1)
                time.sleep(wait)

def gemini_client(timeout_seconds: int | None = None) -> genai.Client:
    """A Gemini client that gives up on each answer after a while (GEMINI_TIMEOUT_SECONDS by default)."""
    return genai.Client(
        api_key=settings.GEMINI_API_KEY,
        http_options=types.HttpOptions(timeout=(timeout_seconds or settings.GEMINI_TIMEOUT_SECONDS) * 1000),
    )

def _analyse(post: DownloadedPost, label: str) -> VideoExtraction:
    """Ask Gemini about a post, turning its failures into messages safe to show."""
    client = gemini_client()
    try:
        return analyse_post(client, post)
    except ExtractionError:
        raise
    except httpx.TimeoutException as e:
        logger.warning("Gemini took too long on %s with every model", label)
        raise ExtractionError("The AI took too long to read this post. Try again in a few minutes.") from e
    except Exception as e:
        # Quota errors, network problems, blocked content etc. Keep the real cause in the logs.
        logger.exception("Gemini could not process %s", label)
        if isinstance(e, genai_errors.APIError) and e.code in RETRYABLE_CODES:
            raise ExtractionError("The AI service is busy right now. Try again in a few minutes.") from e
        raise ExtractionError("The AI service could not process this post") from e

def extract_from_images(images: list[bytes], caption: str | None = None) -> ExtractionResult:
    """Extract the places in a screenshot (or a few), like a photo slideshow."""
    if not settings.GEMINI_API_KEY:
        raise ExtractionError("Screenshot reading is not configured")
    post = DownloadedPost(info={"description": caption} if caption else {}, images=images)
    extraction = _analyse(post, "a screenshot")
    return ExtractionResult(caption=caption, summary=extraction.summary, places=extraction.places)

def extract_from_text(text: str, label: str) -> ExtractionResult:
    """Extract the places an article or blog post recommends, from its text."""
    if not settings.GEMINI_API_KEY:
        raise ExtractionError("Article reading is not configured")
    extraction = _analyse(DownloadedPost(info={"description": text}), label)
    return ExtractionResult(caption=None, summary=extraction.summary, places=extraction.places)

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

    with tempfile.TemporaryDirectory(prefix="triplet-") as dest_dir:
        post = download_post(url, dest_dir)
        extraction = _analyse(post, url)

    return ExtractionResult(
        caption=post.caption,
        summary=extraction.summary,
        places=extraction.places,
        author_name=post.info.get("uploader") or post.info.get("channel"),
        thumbnail_url=post.info.get("thumbnail"),
    )
