#!/usr/bin/env python3
"""
Genere les icones PNG de la PWA sans dependance externe (uniquement la lib standard).
Theme BliiX : fond sombre #282528, accent dore degrade #C9A84C -> #E0C878.
Dessine un cercle avec une coche (check) doree.

Usage : python3 scripts/gen_icons.py
"""
import os
import zlib
import struct
import math

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "icons")

# Couleurs (R, G, B)
BG = (0x28, 0x25, 0x28)
GOLD_1 = (0xC9, 0xA8, 0x4C)
GOLD_2 = (0xE0, 0xC8, 0x78)


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def write_png(path, size, pixels):
    """pixels : liste de size*size tuples (r,g,b)."""
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filtre 0 (None) au debut de chaque ligne
        for x in range(size):
            r, g, b = pixels[y * size + x]
            raw += bytes((r, g, b))

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return c + struct.pack(">I", crc)

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)  # 8 bits, couleur RGB
    idat = zlib.compress(bytes(raw), 9)
    png = sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def aa_coverage(px, py, shape_fn, samples=3):
    """Anti-aliasing par super-echantillonnage : renvoie une couverture 0..1."""
    hit = 0
    step = 1.0 / samples
    for sx in range(samples):
        for sy in range(samples):
            fx = px + (sx + 0.5) * step
            fy = py + (sy + 0.5) * step
            if shape_fn(fx, fy):
                hit += 1
    return hit / (samples * samples)


def make_icon(size, maskable=False):
    pixels = [BG] * (size * size)
    cx = size / 2.0
    cy = size / 2.0
    # Pour une icone "maskable", on garde le motif dans la zone de securite (~80%).
    scale = 0.62 if maskable else 0.72
    ring_outer = size * 0.5 * scale
    ring_inner = ring_outer - max(2.0, size * 0.045)

    def in_ring(fx, fy):
        d = math.hypot(fx - cx, fy - cy)
        return ring_inner <= d <= ring_outer

    # Geometrie de la coche (check)
    p1 = (cx - ring_outer * 0.42, cy + ring_outer * 0.02)
    p2 = (cx - ring_outer * 0.10, cy + ring_outer * 0.36)
    p3 = (cx + ring_outer * 0.46, cy - ring_outer * 0.34)
    thick = max(2.0, size * 0.05)

    def dist_seg(px, py, a, b):
        ax, ay = a
        bx, by = b
        dx, dy = bx - ax, by - ay
        l2 = dx * dx + dy * dy
        if l2 == 0:
            return math.hypot(px - ax, py - ay)
        t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / l2))
        projx, projy = ax + t * dx, ay + t * dy
        return math.hypot(px - projx, py - projy)

    def in_check(fx, fy):
        return (dist_seg(fx, fy, p1, p2) <= thick) or (dist_seg(fx, fy, p2, p3) <= thick)

    for y in range(size):
        for x in range(size):
            idx = y * size + x
            # Couleur doree en degrade diagonal
            t = (x + y) / (2.0 * size)
            gold = lerp(GOLD_1, GOLD_2, t)

            cov_ring = aa_coverage(x, y, in_ring)
            cov_check = aa_coverage(x, y, in_check)
            cov = max(cov_ring, cov_check)
            if cov > 0:
                base = pixels[idx]
                pixels[idx] = tuple(
                    int(round(base[i] * (1 - cov) + gold[i] * cov)) for i in range(3)
                )
    return pixels


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    specs = [
        ("icon-192.png", 192, False),
        ("icon-512.png", 512, False),
        ("icon-maskable-192.png", 192, True),
        ("icon-maskable-512.png", 512, True),
        ("apple-touch-icon.png", 180, False),
        ("favicon.png", 64, False),
    ]
    for name, size, maskable in specs:
        path = os.path.join(OUT_DIR, name)
        write_png(path, size, make_icon(size, maskable))
        print("ecrit", path)


if __name__ == "__main__":
    main()
