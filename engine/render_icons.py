import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

def create_figone_icon(size=1024):
    # Render at 2x supersampling for ultra-crisp anti-aliasing
    canvas_size = size * 2
    img = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    
    # Coordinates scaled for canvas_size
    def s(v):
        return v * (canvas_size / 512.0)
    
    # 1. Background squircle
    pad = s(24)
    box = [pad, pad, canvas_size - pad, canvas_size - pad]
    corner_radius = s(108)
    
    # Create gradient background
    bg_mask = Image.new("L", (canvas_size, canvas_size), 0)
    draw_mask = ImageDraw.Draw(bg_mask)
    draw_mask.rounded_rectangle(box, radius=corner_radius, fill=255)
    
    # Gradient from #D96843 (top-left) to #A83E20 (bottom-right)
    grad = Image.new("RGBA", (canvas_size, canvas_size))
    grad_pixels = grad.load()
    c1 = (217, 104, 67)   # #D96843
    c2 = (168, 62, 32)    # #A83E20
    for y in range(canvas_size):
        for x in range(canvas_size):
            t = (x + y) / (2.0 * canvas_size)
            r = int(c1[0] + (c2[0] - c1[0]) * t)
            g = int(c1[1] + (c2[1] - c1[1]) * t)
            b = int(c1[2] + (c2[2] - c1[2]) * t)
            grad_pixels[x, y] = (r, g, b, 255)
            
    # Apply mask with shadow
    shadow_mask = bg_mask.filter(ImageFilter.GaussianBlur(s(12)))
    shadow = Image.new("RGBA", (canvas_size, canvas_size), (60, 18, 8, 120))
    # Paste shadow slightly offset
    img.paste(shadow, (0, int(s(8))), shadow_mask)
    img.paste(grad, (0, 0), bg_mask)
    
    # Inner border
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle(box, radius=corner_radius, outline=(255, 255, 255, 55), width=max(1, int(s(3))))
    
    # 2. Geometric grid hints (subtle scientific aesthetic)
    grid_color = (255, 255, 255, 28)
    for x in [s(140), s(256), s(372)]:
        draw.line([(x, s(80)), (x, s(432))], fill=grid_color, width=max(1, int(s(1.5))))
    for y in [s(140), s(256), s(372)]:
        draw.line([(s(80), y), (s(432), y)], fill=grid_color, width=max(1, int(s(1.5))))
        
    # 3. Vector shapes: Vertical stem of F
    stem_box = [s(152), s(112), s(220), s(400)]
    draw.rounded_rectangle(stem_box, radius=s(14), fill=(255, 255, 255, 245))
    
    # 4. Top horizontal arm
    top_arm = [s(210), s(112), s(350), s(192)]
    draw.rounded_rectangle(top_arm, radius=s(14), fill=(255, 255, 255, 245))
    
    # 5. Middle arm (slightly warmer tint)
    mid_arm = [s(210), s(232), s(318), s(308)]
    draw.rounded_rectangle(mid_arm, radius=s(14), fill=(252, 225, 214, 235))
    
    # 6. S-curve vector flow line (Golden curve)
    # Sample points on S-curve
    curve_points = []
    for i in range(100):
        t = i / 99.0
        # Smooth bezier from (s(186), s(380)) through (s(330), s(310)) and (s(330), s(170)) to (s(256), s(140))
        p0 = (s(186), s(376))
        p1 = (s(340), s(330))
        p2 = (s(340), s(180))
        p3 = (s(256), s(140))
        cx = (1-t)**3 * p0[0] + 3*(1-t)**2*t * p1[0] + 3*(1-t)*t**2 * p2[0] + t**3 * p3[0]
        cy = (1-t)**3 * p0[1] + 3*(1-t)**2*t * p1[1] + 3*(1-t)*t**2 * p2[1] + t**3 * p3[1]
        curve_points.append((cx, cy))
    
    for i in range(len(curve_points) - 1):
        draw.line([curve_points[i], curve_points[i+1]], fill=(248, 204, 96, 240), width=max(2, int(s(8))))

    # 7. Circular Anchor Nodes (Precision Vector Points)
    def draw_node(cx, cy, r, fill, outline=None, out_w=2):
        node_box = [cx - r, cy - r, cx + r, cy + r]
        draw.ellipse(node_box, fill=fill, outline=outline, width=max(1, int(out_w)))

    # Large top-right node
    draw_node(s(350), s(152), s(18), (255, 255, 255, 255), outline=(200, 88, 52, 255), out_w=s(5))
    # Mid node
    draw_node(s(318), s(270), s(15), (255, 255, 255, 255), outline=(200, 88, 52, 255), out_w=s(4))
    
    # Alignment nodes along the stem
    draw_node(s(186), s(152), s(9), (255, 255, 255, 255))
    draw_node(s(186), s(270), s(9), (255, 255, 255, 255))
    draw_node(s(186), s(376), s(11), (248, 204, 96, 255))

    # Golden spark / accent nodes
    draw_node(s(376), s(348), s(8), (248, 204, 96, 240))
    draw_node(s(398), s(242), s(6), (248, 204, 96, 200))
    draw_node(s(300), s(386), s(7), (255, 255, 255, 200))

    # Downsample with high quality Lanczos filter
    final_img = img.resize((size, size), Image.Resampling.LANCZOS)
    return final_img

# Output paths
icons_dir = Path(__file__).resolve().parents[1] / "src-tauri" / "icons"
icons_dir.mkdir(parents=True, exist_ok=True)

# Generate master icon
master = create_figone_icon(512)
master.save(icons_dir / "icon.png")

# Generate all required dimensions
sizes_map = {
    "32x32.png": 32,
    "128x128.png": 128,
    "128x128@2x.png": 256,
    "Square30x30Logo.png": 30,
    "Square44x44Logo.png": 44,
    "Square71x71Logo.png": 71,
    "Square89x89Logo.png": 89,
    "Square107x107Logo.png": 107,
    "Square142x142Logo.png": 142,
    "Square150x150Logo.png": 150,
    "Square284x284Logo.png": 284,
    "Square310x310Logo.png": 310,
    "StoreLogo.png": 50,
}

for filename, sz in sizes_map.items():
    icon_sized = create_figone_icon(sz)
    icon_sized.save(icons_dir / filename)
    print(f"Generated {filename} ({sz}x{sz})")

# Generate multi-resolution icon.ico
ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
master.save(icons_dir / "icon.ico", format="ICO", sizes=ico_sizes)
print("Generated icon.ico with all multi-resolutions.")
