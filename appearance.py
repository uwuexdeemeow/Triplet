"""
How a trip looks: its style, colour and the choices that go with the style. The app draws it
(mobile/src/appearance); this is the list of what can be picked, so nothing else is saved.
"""

STYLES = ("pixel", "poster", "postcard", "stickers", "pattern", "topo", "ticket", "solid", "photo")

COLOURS = ("harbour", "lagoon", "matcha", "clay", "plum", "sakura", "amber", "slate")

# For the 8-bit style
SCENES = ("city", "beach", "mountains")

# The buddies each style can have, drawn to match it. Styles not listed here have none.
CASTS = {
    "pixel": ("backpacker", "cat", "robot", "ghost", "frog", "plane"),
    "poster": ("fox", "whale", "owl", "bear", "penguin", "capybara"),
    "postcard": ("balloon", "lighthouse", "tram", "sailboat", "swallow", "biplane"),
    "stickers": ("suitcase", "onigiri", "coffee", "sun", "cloud", "camera"),
}

DEFAULT_BUDDIES = {"pixel": "robot", "poster": "fox", "postcard": "tram", "stickers": "onigiri"}

PATTERNS = ("dots", "waves", "grid", "stripes", "checks", "zigzag", "emoji")

# Emoji the pattern style can repeat. A fixed list, so the banner only ever shows these.
EMOJI = ("🍜", "🗼", "🌸", "🍣", "✈️", "🏝️", "⛰️", "☕", "🍦", "🌴", "📸", "🎌",
         "🏖️", "🍕", "🥐", "🌮", "🏔️", "🎡", "🚆", "🌊", "🍷", "🎒", "🗺️", "⭐")

# People's own avatars come from the flat casts, which sit well in the app's plain screens
AVATAR_BUDDIES = CASTS["poster"] + CASTS["stickers"]
