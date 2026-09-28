"""
Read a web article or blog post so its places can be extracted.

The server fetches pages people link to, so it must never be pointed at itself or a private
network: every address is checked before connecting (and again after each redirect), and the
connection goes to the checked address so the name can't be swapped for another in between.
"""
import http.client
import ipaddress
import re
import socket
import ssl
from dataclasses import dataclass
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse

MAX_BYTES = 3 * 1024 * 1024
MAX_REDIRECTS = 5
TIMEOUT = 10
# Enough for any travel article; longer pages are cut
MAX_TEXT_CHARS = 40_000
USER_AGENT = "Mozilla/5.0 (compatible; TripletBot/1.0; +https://github.com/uwuexdeemeow/Triplet)"

class ArticleError(Exception):
    """Raised with a message that is safe to show to users."""

@dataclass
class Article:
    url: str
    title: str | None
    site_name: str | None
    image_url: str | None
    text: str

def _public_address(host: str, port: int) -> str:
    """The first address a host resolves to, if every one of them is on the public internet."""
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror as e:
        raise ArticleError("That website couldn't be found") from e
    addresses = [info[4][0] for info in infos]
    for address in addresses:
        ip = ipaddress.ip_address(address.split("%")[0])
        if not ip.is_global or ip.is_multicast:
            raise ArticleError("That link points to a private address")
    return addresses[0]

class _PinnedHTTPConnection(http.client.HTTPConnection):
    def __init__(self, host: str, address: str, **kwargs):
        super().__init__(host, **kwargs)
        self._address = address

    def connect(self):
        self.sock = socket.create_connection((self._address, self.port), self.timeout)

class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, host: str, address: str, **kwargs):
        super().__init__(host, context=ssl.create_default_context(), **kwargs)
        self._address = address

    def connect(self):
        sock = socket.create_connection((self._address, self.port), self.timeout)
        # Certificates are still checked against the real host name
        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)

def fetch_html(url: str) -> tuple[str, str]:
    """Download a page, following redirects safely. Returns the final url and its HTML."""
    for _ in range(MAX_REDIRECTS + 1):
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            raise ArticleError("Only web links can be read")
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        if port not in (80, 443):
            raise ArticleError("That link uses an unusual port")
        address = _public_address(parsed.hostname, port)

        connection_class = _PinnedHTTPSConnection if parsed.scheme == "https" else _PinnedHTTPConnection
        connection = connection_class(parsed.hostname, address, port=port, timeout=TIMEOUT)
        path = parsed.path or "/"
        if parsed.query:
            path += "?" + parsed.query
        try:
            connection.request("GET", path, headers={
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/xhtml+xml",
                "Accept-Language": "en;q=0.9, *;q=0.5",
            })
            response = connection.getresponse()
            if response.status in (301, 302, 303, 307, 308):
                location = response.getheader("Location")
                if not location:
                    raise ArticleError("The website sent a broken redirect")
                url = urljoin(url, location)
                continue
            if response.status >= 400:
                raise ArticleError(f"The website answered with an error ({response.status})")
            content_type = (response.getheader("Content-Type") or "").lower()
            if "html" not in content_type:
                raise ArticleError("That link isn't a web page")
            body = response.read(MAX_BYTES + 1)
        except (OSError, http.client.HTTPException) as e:
            raise ArticleError("That website couldn't be reached") from e
        finally:
            connection.close()

        charset = re.search(r"charset=([\w-]+)", content_type)
        return url, body[:MAX_BYTES].decode(charset.group(1) if charset else "utf-8", errors="replace")
    raise ArticleError("That link redirects too many times")

class _TextParser(HTMLParser):
    # Page furniture: menus, footers, sidebars and forms around the article
    SKIP = {"script", "style", "noscript", "nav", "footer", "header", "aside", "form", "svg", "button", "iframe"}
    # Never text a reader sees, whatever the page's layout
    ALWAYS_SKIP = {"script", "style", "noscript", "svg", "iframe"}
    BLOCKS = {"p", "h1", "h2", "h3", "h4", "li", "blockquote", "figcaption", "td", "br", "div", "section", "article"}

    def __init__(self, strict: bool = True):
        super().__init__()
        if not strict:
            self.SKIP = self.ALWAYS_SKIP
        self.skipping = 0
        self.parts: list[str] = []
        self.meta: dict[str, str] = {}
        self.in_title = False
        self.title = ""

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "meta":
            key = (attrs.get("property") or attrs.get("name") or "").lower()
            if key and attrs.get("content"):
                self.meta.setdefault(key, attrs["content"])
        elif tag == "title":
            self.in_title = True
        elif tag in self.SKIP:
            self.skipping += 1
        elif tag in self.BLOCKS:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False
        elif tag in self.SKIP and self.skipping:
            self.skipping -= 1
        elif tag in self.BLOCKS:
            self.parts.append("\n")

    def handle_data(self, data):
        if self.in_title:
            self.title += data
        elif not self.skipping:
            self.parts.append(data)

def _page_text(html: str, strict: bool) -> tuple[str, _TextParser]:
    parser = _TextParser(strict)
    parser.feed(html)
    lines = [re.sub(r"\s+", " ", line).strip() for line in "".join(parser.parts).split("\n")]
    text = "\n".join(line for line in lines if len(line) > 1)
    return re.sub(r"\n{3,}", "\n\n", text), parser

def parse_article(url: str, html: str) -> Article:
    text, parser = _page_text(html, strict=True)
    # Some sites put the whole article inside a tag that's usually furniture (one wraps it in
    # <aside>). If leaving furniture out lost most of the page, the article was in it: keep it all.
    everything, _ = _page_text(html, strict=False)
    if len(text) < 0.4 * len(everything):
        text = everything
    text = text[:MAX_TEXT_CHARS]
    meta = parser.meta
    image = meta.get("og:image") or meta.get("twitter:image")
    return Article(
        url=url,
        title=(meta.get("og:title") or parser.title.strip() or None),
        site_name=meta.get("og:site_name"),
        image_url=urljoin(url, image) if image else None,
        text=text,
    )

def fetch_article(url: str) -> Article:
    final_url, html = fetch_html(url)
    article = parse_article(final_url, html)
    if len(article.text) < 200:
        # Pages built entirely by JavaScript have almost no text in their HTML
        raise ArticleError("There wasn't enough text on that page to read")
    return article
