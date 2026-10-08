#!/usr/bin/env python
"""Рендерить diploma/figures/*.mmd у PNG/JPG через mermaid.ink (запасний шлях — kroki.io)."""
import base64
import os
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
FIG = os.path.join(HERE, "figures")
STEMS = [
    "rys-1-1",
    "rys-1-2",
    "rys-1-3",
    "rys-2-1",
    "rys-2-2",
    "rys-2-3",
    "rys-3-7",
    "rys-4-1",
    "rys-4-2",
    "dod-b1",
    "dod-b2",
    "dod-b3",
    "dod-b4",
]


def fetch(url, data=None, timeout=30):
    req = urllib.request.Request(
        url,
        data=data,
        headers={"User-Agent": "Mozilla/5.0 series-lab-diploma", "Content-Type": "text/plain"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def render(src: str) -> tuple[bytes, str]:
    # mermaid.ink: base64url від сирого тексту (стабільний для невеликих схем)
    b64 = base64.urlsafe_b64encode(src.encode("utf-8")).decode().rstrip("=")
    try:
        data = fetch("https://mermaid.ink/img/" + b64, timeout=40)
        if len(data) > 500:
            ext = "jpg" if data[:2] == b"\xff\xd8" else "png"
            return data, ext
    except Exception as e:
        print("  mermaid.ink:", e)
    # kroki
    data = fetch("https://kroki.io/mermaid/png", data=src.encode("utf-8"), timeout=40)
    ext = "jpg" if data[:2] == b"\xff\xd8" else "png"
    return data, ext


def main():
    os.makedirs(FIG, exist_ok=True)
    for stem in STEMS:
        mmd = os.path.join(FIG, stem + ".mmd")
        if not os.path.isfile(mmd):
            print("SKIP", stem, "(немає .mmd)")
            continue
        src = open(mmd, encoding="utf-8").read().strip() + "\n"
        print(stem, "…")
        try:
            data, ext = render(src)
        except Exception as e:
            print("FAIL", stem, e)
            continue
        # прибрати старі розширення
        for old in (".png", ".jpg", ".jpeg"):
            p = os.path.join(FIG, stem + old)
            if os.path.isfile(p):
                os.remove(p)
        raw = os.path.join(FIG, f"{stem}._raw")
        open(raw, "wb").write(data)
        try:
            from PIL import Image

            im = Image.open(raw)
            im.load()
            out = os.path.join(FIG, f"{stem}.png")
            if im.mode in ("RGBA", "LA", "P"):
                im.save(out, format="PNG")
            else:
                im.convert("RGB").save(out, format="PNG")
            os.remove(raw)
        except Exception as e:
            out = os.path.join(FIG, f"{stem}.{ext}")
            os.replace(raw, out)
            print("WARN PNG convert:", e)
        else:
            print("OK", out, os.path.getsize(out))


if __name__ == "__main__":
    main()
