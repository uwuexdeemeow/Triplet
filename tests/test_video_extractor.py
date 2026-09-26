from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
import yt_dlp

import video_extractor
from config import settings
from video_extractor import ExtractionError, VideoExtraction, Place, analyse_video, download_video, extract_from_video

def fake_youtube_dl(info: dict, write_file: bool = True, error: Exception | None = None):
    """Build a stand-in for yt_dlp.YoutubeDL that 'downloads' into the requested folder."""
    class FakeYoutubeDL:
        def __init__(self, options):
            self.dest_dir = Path(options["outtmpl"]).parent

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def extract_info(self, url, download):
            if error:
                raise error
            return info

        def process_ie_result(self, result, download):
            if write_file:
                (self.dest_dir / "video.mp4").write_bytes(b"fake video")

    return FakeYoutubeDL

def test_download_video(tmp_path):
    with patch("yt_dlp.YoutubeDL", fake_youtube_dl({"duration": 30, "description": "caption"})):
        path, info = download_video("https://www.tiktok.com/@a/video/1", str(tmp_path))

    assert path.name == "video.mp4"
    assert info["description"] == "caption"

def test_download_rejects_long_videos(tmp_path):
    with patch("yt_dlp.YoutubeDL", fake_youtube_dl({"duration": settings.VIDEO_MAX_DURATION_SECONDS + 1})):
        with pytest.raises(ExtractionError, match="longer than"):
            download_video("https://youtu.be/abc", str(tmp_path))

def test_download_error_is_user_friendly(tmp_path):
    error = yt_dlp.utils.DownloadError("HTTP Error 404")

    with patch("yt_dlp.YoutubeDL", fake_youtube_dl({}, error=error)):
        with pytest.raises(ExtractionError, match="private or deleted"):
            download_video("https://www.tiktok.com/@a/video/1", str(tmp_path))

def test_download_with_no_file_fails(tmp_path):
    # yt-dlp skips files over max_filesize without raising
    with patch("yt_dlp.YoutubeDL", fake_youtube_dl({"duration": 30}, write_file=False)):
        with pytest.raises(ExtractionError, match="too large"):
            download_video("https://www.tiktok.com/@a/video/1", str(tmp_path))

def test_analyse_small_video_is_sent_inline(tmp_path):
    video = tmp_path / "video.mp4"
    video.write_bytes(b"fake video")
    expected = VideoExtraction(summary="Ramen", places=[Place(name="Ichiran")])

    client = MagicMock()
    client.models.generate_content.return_value = SimpleNamespace(parsed=expected, text=None)

    result = analyse_video(client, video, "Best ramen #tokyo")

    assert result == expected
    client.files.upload.assert_not_called()
    contents = client.models.generate_content.call_args.kwargs["contents"]
    assert "Best ramen #tokyo" in contents[1]

def test_analyse_falls_back_to_parsing_text(tmp_path):
    video = tmp_path / "video.mp4"
    video.write_bytes(b"fake video")

    client = MagicMock()
    client.models.generate_content.return_value = SimpleNamespace(
        parsed=None,
        text='{"summary": "Cafe tour", "places": [{"name": "Blue Bottle"}]}'
    )

    result = analyse_video(client, video, None)

    assert result.places[0].name == "Blue Bottle"

def test_analyse_large_video_uses_files_api_and_cleans_up(tmp_path, monkeypatch):
    monkeypatch.setattr(video_extractor, "INLINE_LIMIT_BYTES", 1)
    video = tmp_path / "video.mp4"
    video.write_bytes(b"fake video")

    uploaded = SimpleNamespace(name="files/abc", state=video_extractor.types.FileState.ACTIVE)
    client = MagicMock()
    client.files.upload.return_value = uploaded
    client.models.generate_content.return_value = SimpleNamespace(parsed=VideoExtraction(), text=None)

    analyse_video(client, video, None)

    assert client.models.generate_content.call_args.kwargs["contents"][0] is uploaded
    client.files.delete.assert_called_once_with(name="files/abc")

def test_extract_requires_api_key(monkeypatch):
    monkeypatch.setattr(settings, "GEMINI_API_KEY", None)

    with pytest.raises(ExtractionError, match="not configured"):
        extract_from_video("https://www.tiktok.com/@a/video/1")

def test_extract_wraps_ai_errors(monkeypatch):
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "test-key")

    with patch("yt_dlp.YoutubeDL", fake_youtube_dl({"duration": 30, "description": "caption"})), \
         patch("video_extractor.analyse_video", side_effect=RuntimeError("429 quota exceeded")):
        with pytest.raises(ExtractionError, match="AI service"):
            extract_from_video("https://www.tiktok.com/@a/video/1")

def test_extract_returns_caption_and_places(monkeypatch):
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "test-key")
    extraction = VideoExtraction(summary="Ramen", places=[Place(name="Ichiran")])

    with patch("yt_dlp.YoutubeDL", fake_youtube_dl({"duration": 30, "description": "Best ramen"})), \
         patch("video_extractor.analyse_video", return_value=extraction):
        result = extract_from_video("https://www.tiktok.com/@a/video/1")

    assert result.caption == "Best ramen"
    assert result.places[0].name == "Ichiran"
