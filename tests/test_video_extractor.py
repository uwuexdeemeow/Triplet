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
    "id": "7",
    "extractor_key": "TikTok",
    "webpage_url": "https://www.tiktok.com/@a/video/7",
    "duration": 51,
    "description": "5 ramen shops 📍 Menya Itto",
    "thumbnail": "https://example.com/cover.jpg",
    "formats": [{"vcodec": "none", "acodec": "aac"}],
}
JPEG = b"\xff\xd8\xff" + b"cover"

def slideshow_page(count: int) -> dict:
    """TikTok's page data for a slideshow, as yt-dlp's extractor returns it."""
    return {"imagePost": {"images": [{"imageURL": {"urlList": [f"https://example.com/slide{i}.jpg"]}} for i in range(count)]}}

def fake_youtube_dl(
    info: dict,
    write_file: bool = True,
    error: Exception | None = None,
    cover: bytes | None = JPEG,
    page_data: dict | Exception | None = None,
):
    """Build a stand-in for yt_dlp.YoutubeDL that 'downloads' into the requested folder."""
    class FakeExtractor:
        def _extract_web_data_and_status(self, url, video_id, fatal=True):
            if isinstance(page_data, Exception):
                raise page_data
            return page_data or {}, 0

    class FakeYoutubeDL:
        requested_urls = []

        def __init__(self, options):
            self.dest_dir = Path(options["outtmpl"]).parent

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def extract_info(self, url, download, process=True):
            FakeYoutubeDL.requested_urls.append(url)
            FakeYoutubeDL.processed = process
            if error:
                raise error
            return info

        def process_ie_result(self, result, download):
            if write_file:
                (self.dest_dir / "video.mp4").write_bytes(b"fake video")

        def get_info_extractor(self, key):
            return FakeExtractor()

        def urlopen(self, url):
            if "slide" in url:
                return io.BytesIO(f"slide:{url[-5]}".encode())
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
    assert post.images == []
    assert post.caption == "Best ramen"

def test_download_photo_post_reads_every_slide(tmp_path):
    fake = fake_youtube_dl(SLIDESHOW_INFO, page_data=slideshow_page(3))

    with patch("yt_dlp.YoutubeDL", fake):
        post = download_post("https://www.tiktok.com/@a/photo/1", str(tmp_path))

    assert fake.requested_urls == ["https://www.tiktok.com/@a/video/1"]
    assert post.video_path is None
    assert post.images == [b"slide:0", b"slide:1", b"slide:2"]
    # Slideshows are allowed to be longer than videos because nothing is downloaded to disk
    assert list(tmp_path.iterdir()) == []

def test_slides_are_capped(tmp_path, monkeypatch):
    monkeypatch.setattr(video_extractor, "MAX_SLIDES", 2)

    with patch("yt_dlp.YoutubeDL", fake_youtube_dl(SLIDESHOW_INFO, page_data=slideshow_page(5))):
        post = download_post("https://www.tiktok.com/@a/photo/1", str(tmp_path))

    assert post.images == [b"slide:0", b"slide:1"]

def test_slides_stop_before_the_size_limit(tmp_path, monkeypatch):
    # Each fake slide is 7 bytes
    monkeypatch.setattr(video_extractor, "MAX_SLIDE_BYTES", 15)

    with patch("yt_dlp.YoutubeDL", fake_youtube_dl(SLIDESHOW_INFO, page_data=slideshow_page(5))):
        post = download_post("https://www.tiktok.com/@a/photo/1", str(tmp_path))

    assert len(post.images) == 2

def test_falls_back_to_the_cover_when_slides_fail(tmp_path):
    # e.g. a yt-dlp update renamed the internal method
    with patch("yt_dlp.YoutubeDL", fake_youtube_dl(SLIDESHOW_INFO, page_data=AttributeError("renamed"))):
        post = download_post("https://www.tiktok.com/@a/photo/1", str(tmp_path))

    assert post.images == [JPEG]

def test_photo_post_without_cover_still_has_caption(tmp_path):
    with patch("yt_dlp.YoutubeDL", fake_youtube_dl(SLIDESHOW_INFO, cover=None)):
        post = download_post("https://www.tiktok.com/@a/photo/1", str(tmp_path))

    assert post.images == []
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

def test_youtube_is_watched_by_link_not_downloaded(tmp_path):
    # YouTube only offers separate video and audio streams, which can't be joined without ffmpeg
    info = {"id": "TaSlCACPLmQ", "duration": 50, "title": "Ramen", "thumbnails": [{"url": "small"}, {"url": "big"}]}
    fake = fake_youtube_dl(info)

    with patch("yt_dlp.YoutubeDL", fake):
        post = download_post("https://youtu.be/TaSlCACPLmQ", str(tmp_path))

    assert fake.processed is False
    assert post.video_url == "https://www.youtube.com/watch?v=TaSlCACPLmQ"
    assert post.video_path is None
    assert post.info["thumbnail"] == "big"
    assert list(tmp_path.iterdir()) == []

def test_instagram_carousel_reads_each_cover(tmp_path):
    info = {
        "_type": "playlist",
        "id": "DSZ",
        "description": "Must try food in Tokyo",
        "entries": [
            {"id": "a", "thumbnail": "https://example.com/slide0.jpg"},
            {"id": "b", "thumbnails": [{"url": "https://example.com/slide1.jpg"}], "formats": [{"vcodec": "h264"}]},
            {"id": "c"},
        ],
    }

    with patch("yt_dlp.YoutubeDL", fake_youtube_dl(info)):
        post = download_post("https://www.instagram.com/p/DSZ/", str(tmp_path))

    assert post.images == [b"slide:0", b"slide:1"]
    assert post.caption == "Must try food in Tokyo"
    assert post.info["thumbnail"] == "https://example.com/slide0.jpg"

def test_single_instagram_photo_uses_its_image(tmp_path):
    info = {"id": "x", "extractor_key": "Instagram", "description": "Cafe", "thumbnail": "https://example.com/p.jpg", "formats": []}

    with patch("yt_dlp.YoutubeDL", fake_youtube_dl(info)):
        post = download_post("https://www.instagram.com/p/x/", str(tmp_path))

    assert post.images == [JPEG]

def test_analyse_youtube_sends_the_link():
    client = gemini_client(parsed=VideoExtraction())

    analyse_post(client, DownloadedPost(info={"title": "Ramen"}, video_url="https://www.youtube.com/watch?v=abc"))

    contents = sent_contents(client)
    assert contents[0].file_data.file_uri == "https://www.youtube.com/watch?v=abc"
    client.files.upload.assert_not_called()

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

def test_analyse_photo_post_sends_every_slide():
    client = gemini_client(parsed=VideoExtraction())
    webp = b"RIFF\x00\x00\x00\x00WEBPVP8 "

    analyse_post(client, DownloadedPost(info={"description": "Ramen"}, images=[JPEG, webp]))

    contents = sent_contents(client)
    assert [part.inline_data.mime_type for part in contents[:2]] == ["image/jpeg", "image/webp"]
    assert "Ramen" in contents[2]

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

@pytest.fixture(autouse=True)
def no_busy_models():
    # Which models were busy is remembered between posts, so each test starts afresh
    video_extractor._busy_until.clear()

def api_error(code: int):
    return video_extractor.genai_errors.APIError(code, {"error": {"code": code, "message": "test", "status": "TEST"}})

def test_busy_gemini_is_retried(monkeypatch):
    monkeypatch.setattr(video_extractor.time, "sleep", lambda seconds: None)
    monkeypatch.setattr(settings, "GEMINI_FALLBACK_MODELS", [])
    client = gemini_client(parsed=VideoExtraction(places=[Place(name="Ichiran")]))
    good_response = client.models.generate_content.return_value
    client.models.generate_content.side_effect = [api_error(503), good_response]

    result = analyse_post(client, DownloadedPost(info={"description": "Ramen"}))

    assert result.places[0].name == "Ichiran"
    assert client.models.generate_content.call_count == 2

def test_bad_request_is_not_retried(monkeypatch):
    monkeypatch.setattr(video_extractor.time, "sleep", lambda seconds: None)
    client = gemini_client()
    client.models.generate_content.side_effect = api_error(400)

    with pytest.raises(video_extractor.genai_errors.APIError):
        analyse_post(client, DownloadedPost(info={"description": "Ramen"}))

    assert client.models.generate_content.call_count == 1

def test_still_busy_after_retries_says_so(monkeypatch):
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(settings, "GEMINI_FALLBACK_MODELS", ["backup-model"])
    monkeypatch.setattr(video_extractor.time, "sleep", lambda seconds: None)

    with patch("yt_dlp.YoutubeDL", fake_youtube_dl(VIDEO_INFO)), \
         patch("video_extractor.genai.Client") as client_class:
        client_class.return_value.models.generate_content.side_effect = api_error(429)
        with pytest.raises(ExtractionError, match="busy"):
            extract_from_video("https://www.tiktok.com/@a/video/1")

    # Main model: one try, then straight to the backup. Backup (last) model: first try and two retries.
    assert client_class.return_value.models.generate_content.call_count == 4

class FakeResponse:
    def __init__(self, url):
        self.url = url

def test_short_links_are_expanded():
    with patch("curl_cffi.requests.head", return_value=FakeResponse("https://www.tiktok.com/@a/photo/1?_r=1")) as head:
        assert video_extractor.expand_short_link("https://vt.tiktok.com/ZSb2Lx5Wx/") == "https://www.tiktok.com/@a/photo/1?_r=1"

    assert head.call_args.kwargs["allow_redirects"] is True

@pytest.mark.parametrize("url", [
    "https://www.tiktok.com/@a/video/1",
    "https://youtu.be/abc",
])
def test_full_links_are_not_fetched(url):
    with patch("curl_cffi.requests.head") as head:
        assert video_extractor.expand_short_link(url) == url

    head.assert_not_called()

def test_unresolvable_short_link_is_kept():
    with patch("curl_cffi.requests.head", side_effect=OSError("offline")):
        assert video_extractor.expand_short_link("https://vm.tiktok.com/abc/") == "https://vm.tiktok.com/abc/"

def test_short_link_to_a_photo_post(tmp_path):
    fake = fake_youtube_dl(SLIDESHOW_INFO, page_data=slideshow_page(2))

    with patch("curl_cffi.requests.head", return_value=FakeResponse("https://www.tiktok.com/@a/photo/7?_r=1&_t=x")), \
         patch("yt_dlp.YoutubeDL", fake):
        post = download_post("https://vt.tiktok.com/ZSb2Lx5Wx/", str(tmp_path))

    assert fake.requested_urls[-1] == "https://www.tiktok.com/@a/video/7"
    assert post.images == [b"slide:0", b"slide:1"]

def test_busy_model_falls_back_to_the_next(monkeypatch):
    monkeypatch.setattr(video_extractor.time, "sleep", lambda seconds: None)
    monkeypatch.setattr(settings, "GEMINI_MODEL", "main-model")
    monkeypatch.setattr(settings, "GEMINI_FALLBACK_MODELS", ["backup-model"])
    client = gemini_client(parsed=VideoExtraction(places=[Place(name="Ichiran")]))
    good_response = client.models.generate_content.return_value
    # The main model is busy, so the backup is asked straight away, without waiting
    client.models.generate_content.side_effect = [api_error(503), good_response]
    waits = []
    monkeypatch.setattr(video_extractor.time, "sleep", waits.append)

    result = analyse_post(client, DownloadedPost(info={"description": "Ramen"}))

    assert result.places[0].name == "Ichiran"
    models = [call.kwargs["model"] for call in client.models.generate_content.call_args_list]
    assert models == ["main-model", "backup-model"]
    assert waits == []

def test_a_busy_model_is_tried_last_for_a_while(monkeypatch):
    monkeypatch.setattr(settings, "GEMINI_MODEL", "main-model")
    monkeypatch.setattr(settings, "GEMINI_FALLBACK_MODELS", ["backup-model"])
    client = gemini_client(parsed=VideoExtraction())
    good_response = client.models.generate_content.return_value
    client.models.generate_content.side_effect = [api_error(503), good_response, good_response]

    analyse_post(client, DownloadedPost(info={"description": "Ramen"}))
    # The next post starts with the backup, rather than waiting on the busy model again
    analyse_post(client, DownloadedPost(info={"description": "Sushi"}))

    models = [call.kwargs["model"] for call in client.models.generate_content.call_args_list]
    assert models == ["main-model", "backup-model", "backup-model"]

    # A couple of minutes later the main model is first again
    monkeypatch.setattr(video_extractor.time, "monotonic", lambda: 10**9)
    assert video_extractor._model_order() == ["main-model", "backup-model"]

def test_unknown_model_is_skipped(monkeypatch):
    monkeypatch.setattr(settings, "GEMINI_MODEL", "retired-model")
    monkeypatch.setattr(settings, "GEMINI_FALLBACK_MODELS", ["backup-model"])
    client = gemini_client(parsed=VideoExtraction())
    good_response = client.models.generate_content.return_value
    client.models.generate_content.side_effect = [api_error(404), good_response]

    analyse_post(client, DownloadedPost(info={"description": "Ramen"}))

    models = [call.kwargs["model"] for call in client.models.generate_content.call_args_list]
    assert models == ["retired-model", "backup-model"]

def test_a_model_that_takes_too_long_is_skipped(monkeypatch):
    import httpx
    monkeypatch.setattr(settings, "GEMINI_MODEL", "main-model")
    monkeypatch.setattr(settings, "GEMINI_FALLBACK_MODELS", ["backup-model"])
    client = gemini_client(parsed=VideoExtraction(places=[Place(name="Ichiran")]))
    good_response = client.models.generate_content.return_value
    client.models.generate_content.side_effect = [httpx.ReadTimeout("slow"), good_response]

    result = analyse_post(client, DownloadedPost(info={"description": "Ramen"}))

    assert result.places[0].name == "Ichiran"
    models = [call.kwargs["model"] for call in client.models.generate_content.call_args_list]
    assert models == ["main-model", "backup-model"]
    assert video_extractor._model_order() == ["backup-model", "main-model"]

def test_every_model_taking_too_long_says_so(monkeypatch):
    import httpx
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(settings, "GEMINI_FALLBACK_MODELS", ["backup-model"])

    with patch("yt_dlp.YoutubeDL", fake_youtube_dl(VIDEO_INFO)), \
         patch("video_extractor.genai.Client") as client_class:
        client_class.return_value.models.generate_content.side_effect = httpx.ReadTimeout("slow")
        with pytest.raises(ExtractionError, match="too long"):
            extract_from_video("https://www.tiktok.com/@a/video/1")

    # The client is told to give up after GEMINI_TIMEOUT_SECONDS
    assert client_class.call_args.kwargs["http_options"].timeout == settings.GEMINI_TIMEOUT_SECONDS * 1000
