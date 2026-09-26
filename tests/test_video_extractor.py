import io
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
import yt_dlp

import video_extractor
from config import settings
from video_extractor import (
    DownloadedPost, ExtractionError, Place, VideoExtraction,
    analyse_post, download_post, extract_from_video, normalise_url,
)

VIDEO_INFO = {"duration": 30, "description": "Best ramen", "formats": [{"vcodec": "h264", "acodec": "aac"}]}
SLIDESHOW_INFO = {
    "duration": 51,
    "description": "5 ramen shops 📍 Menya Itto",
    "thumbnail": "https://example.com/cover.jpg",
    "formats": [{"vcodec": "none", "acodec": "aac"}],
}

def fake_youtube_dl(info: dict, write_file: bool = True, error: Exception | None = None, cover: bytes | None = b"jpeg"):
    """Build a stand-in for yt_dlp.YoutubeDL that 'downloads' into the requested folder."""
    class FakeYoutubeDL:
        requested_urls = []

        def __init__(self, options):
            self.dest_dir = Path(options["outtmpl"]).parent

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def extract_info(self, url, download):
            FakeYoutubeDL.requested_urls.append(url)
            if error:
                raise error
            return info

        def process_ie_result(self, result, download):
            if write_file:
                (self.dest_dir / "video.mp4").write_bytes(b"fake video")

        def urlopen(self, url):
            if cover is None:
                raise OSError("404")
            return io.BytesIO(cover)

    return FakeYoutubeDL

@pytest.mark.parametrize("url, expected", [
    (
        "https://www.tiktok.com/@guide/photo/123?is_from_webapp=1",
        "https://www.tiktok.com/@guide/video/123",
    ),
    ("https://www.tiktok.com/@guide/video/123", "https://www.tiktok.com/@guide/video/123"),
    ("https://example.com/photo/123", "https://example.com/photo/123"),
])
def test_normalise_url(url, expected):
    assert normalise_url(url) == expected

def test_download_video(tmp_path):
    with patch("yt_dlp.YoutubeDL", fake_youtube_dl(VIDEO_INFO)):
        post = download_post("https://www.tiktok.com/@a/video/1", str(tmp_path))

    assert post.video_path.name == "video.mp4"
    assert post.cover_image is None
    assert post.caption == "Best ramen"

def test_download_photo_post_uses_cover_image(tmp_path):
    fake = fake_youtube_dl(SLIDESHOW_INFO)

    with patch("yt_dlp.YoutubeDL", fake):
        post = download_post("https://www.tiktok.com/@a/photo/1", str(tmp_path))

    assert fake.requested_urls == ["https://www.tiktok.com/@a/video/1"]
    assert post.video_path is None
    assert post.cover_image == b"jpeg"
    # Slideshows are allowed to be longer than videos because only the cover is used
    assert list(tmp_path.iterdir()) == []

def test_photo_post_without_cover_still_has_caption(tmp_path):
    with patch("yt_dlp.YoutubeDL", fake_youtube_dl(SLIDESHOW_INFO, cover=None)):
        post = download_post("https://www.tiktok.com/@a/photo/1", str(tmp_path))

    assert post.cover_image is None
    assert post.caption == SLIDESHOW_INFO["description"]

def test_download_rejects_long_videos(tmp_path):
    info = {**VIDEO_INFO, "duration": settings.VIDEO_MAX_DURATION_SECONDS + 1}

    with patch("yt_dlp.YoutubeDL", fake_youtube_dl(info)):
        with pytest.raises(ExtractionError, match="longer than"):
            download_post("https://youtu.be/abc", str(tmp_path))

def test_download_error_is_user_friendly(tmp_path):
    error = yt_dlp.utils.DownloadError("HTTP Error 404")

    with patch("yt_dlp.YoutubeDL", fake_youtube_dl({}, error=error)):
        with pytest.raises(ExtractionError, match="private or deleted"):
            download_post("https://www.tiktok.com/@a/video/1", str(tmp_path))

def test_download_with_no_file_fails(tmp_path):
    # yt-dlp skips files over max_filesize without raising
    with patch("yt_dlp.YoutubeDL", fake_youtube_dl(VIDEO_INFO, write_file=False)):
        with pytest.raises(ExtractionError, match="too large"):
            download_post("https://www.tiktok.com/@a/video/1", str(tmp_path))

def gemini_client(parsed=None, text=None):
    client = MagicMock()
    client.models.generate_content.return_value = SimpleNamespace(parsed=parsed, text=text)
    return client

def sent_contents(client):
    return client.models.generate_content.call_args.kwargs["contents"]

def test_analyse_small_video_is_sent_inline(tmp_path):
    video = tmp_path / "video.mp4"
    video.write_bytes(b"fake video")
    expected = VideoExtraction(summary="Ramen", places=[Place(name="Ichiran")])
    client = gemini_client(parsed=expected)

    result = analyse_post(client, DownloadedPost(info={"description": "Best ramen #tokyo"}, video_path=video))

    assert result == expected
    client.files.upload.assert_not_called()
    contents = sent_contents(client)
    assert contents[0].inline_data.mime_type == "video/mp4"
    assert "Best ramen #tokyo" in contents[1]

def test_analyse_photo_post_sends_cover_image():
    client = gemini_client(parsed=VideoExtraction())

    analyse_post(client, DownloadedPost(info={"description": "Ramen"}, cover_image=b"jpeg"))

    assert sent_contents(client)[0].inline_data.mime_type == "image/jpeg"

def test_analyse_caption_only():
    client = gemini_client(parsed=VideoExtraction())

    analyse_post(client, DownloadedPost(info={"description": "Ramen at Menya Itto"}))

    contents = sent_contents(client)
    assert len(contents) == 1
    assert "Ramen at Menya Itto" in contents[0]

def test_analyse_needs_something_to_read():
    with pytest.raises(ExtractionError, match="no video, image or caption"):
        analyse_post(gemini_client(), DownloadedPost(info={}))

def test_analyse_falls_back_to_parsing_text():
    client = gemini_client(text='{"summary": "Cafe tour", "places": [{"name": "Blue Bottle"}]}')

    result = analyse_post(client, DownloadedPost(info={"description": "Cafes"}))

    assert result.places[0].name == "Blue Bottle"

def test_analyse_large_video_uses_files_api_and_cleans_up(tmp_path, monkeypatch):
    monkeypatch.setattr(video_extractor, "INLINE_LIMIT_BYTES", 1)
    video = tmp_path / "video.mp4"
    video.write_bytes(b"fake video")

    uploaded = SimpleNamespace(name="files/abc", state=video_extractor.types.FileState.ACTIVE)
    client = gemini_client(parsed=VideoExtraction())
    client.files.upload.return_value = uploaded

    analyse_post(client, DownloadedPost(info={}, video_path=video))

    assert sent_contents(client)[0] is uploaded
    client.files.delete.assert_called_once_with(name="files/abc")

def test_extract_requires_api_key(monkeypatch):
    monkeypatch.setattr(settings, "GEMINI_API_KEY", None)

    with pytest.raises(ExtractionError, match="not configured"):
        extract_from_video("https://www.tiktok.com/@a/video/1")

def test_extract_wraps_ai_errors(monkeypatch):
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "test-key")

    with patch("yt_dlp.YoutubeDL", fake_youtube_dl(VIDEO_INFO)), \
         patch("video_extractor.analyse_post", side_effect=RuntimeError("429 quota exceeded")):
        with pytest.raises(ExtractionError, match="AI service"):
            extract_from_video("https://www.tiktok.com/@a/video/1")

def test_extract_returns_caption_and_places(monkeypatch):
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "test-key")
    extraction = VideoExtraction(summary="Ramen", places=[Place(name="Ichiran")])

    with patch("yt_dlp.YoutubeDL", fake_youtube_dl(VIDEO_INFO)), \
         patch("video_extractor.analyse_post", return_value=extraction):
        result = extract_from_video("https://www.tiktok.com/@a/video/1")

    assert result.caption == "Best ramen"
    assert result.places[0].name == "Ichiran"
