"""Penney Construction — Process Map PDF (dark, diagram-first).

5 landscape-letter pages drawn directly on the ReportLab canvas:
  1. Cover
  2. The pipeline at a glance (13 stages / 5 phases)
  3. Lead -> signed contract (detail flow with decision loops)
  4. Permit -> done (build flow with inspection loops)
  5. Who runs what (swimlane)
"""
import os
import math
from reportlab.lib.pagesizes import letter, landscape
from reportlab.lib import colors
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.pdfbase.pdfmetrics import stringWidth

BASE = os.path.dirname(os.path.abspath(__file__))
LOGO_FULL = os.path.join(BASE, "assets", "penney_logo_dark.png")
LOGO_MARK = os.path.join(BASE, "assets", "penney_mark_dark.png")
OUT = os.path.join(BASE, "penney-process-map.pdf")

W, H = landscape(letter)  # 792 x 612

# ── Brand (dark theme) ────────────────────────────────────────────────────────
PAGE_BG   = colors.HexColor("#232323")
PANEL     = colors.HexColor("#2C2C2C")
CARD      = colors.HexColor("#3D3D3D")
CARD_EDGE = colors.HexColor("#565656")
ORANGE    = colors.HexColor("#E8510A")
ORANGE_HI = colors.HexColor("#FF6A1F")
LGRAY     = colors.HexColor("#A0A0A0")
FAINT     = colors.HexColor("#6E6E6E")
OFFWHT    = colors.HexColor("#F5F5F5")
WHITE     = colors.white
FLOW      = colors.HexColor("#C4C4C4")   # main flow arrows
GRID_DOT  = colors.HexColor("#2E2E2E")
LINE_DIM  = colors.HexColor("#3C3C3C")

F, FB = "Helvetica", "Helvetica-Bold"
N_PAGES = 5


# ── low-level helpers ─────────────────────────────────────────────────────────
def rrect(c, x, y, w, h, r=6, fill=CARD, stroke=CARD_EDGE, sw=0.8):
    if fill is not None:
        c.setFillColor(fill)
    if stroke is not None:
        c.setStrokeColor(stroke)
        c.setLineWidth(sw)
    c.roundRect(x, y, w, h, r, fill=1 if fill is not None else 0,
                stroke=1 if stroke is not None else 0)


def ctext(c, cx, y, s, font=F, size=8, color=WHITE):
    c.setFont(font, size)
    c.setFillColor(color)
    c.drawCentredString(cx, y, s)


def ltext(c, x, y, s, font=F, size=8, color=WHITE):
    c.setFont(font, size)
    c.setFillColor(color)
    c.drawString(x, y, s)


def rtext(c, x, y, s, font=F, size=8, color=WHITE):
    c.setFont(font, size)
    c.setFillColor(color)
    c.drawRightString(x, y, s)


def wrap(text, font, size, maxw):
    words = text.split()
    lines, cur = [], ""
    for w_ in words:
        t = (cur + " " + w_).strip()
        if stringWidth(t, font, size) <= maxw or not cur:
            cur = t
        else:
            lines.append(cur)
            cur = w_
    if cur:
        lines.append(cur)
    return lines


def cwrapped(c, cx, top_y, text, font, size, color, maxw, leading=None):
    """Draw wrapped, centered text; top_y is the baseline of the first line.
    Returns baseline of the line after the last one drawn."""
    leading = leading or size + 2
    y = top_y
    for ln in wrap(text, font, size, maxw):
        ctext(c, cx, y, ln, font, size, color)
        y -= leading
    return y


def arrowhead(c, x, y, angle, size=7.0, color=FLOW):
    """Filled triangle pointing along `angle` (radians), tip at (x, y)."""
    c.saveState()
    c.translate(x, y)
    c.rotate(math.degrees(angle))
    p = c.beginPath()
    p.moveTo(0, 0)
    p.lineTo(-size, size * 0.55)
    p.lineTo(-size, -size * 0.55)
    p.close()
    c.setFillColor(color)
    c.setLineWidth(0)
    c.drawPath(p, fill=1, stroke=0)
    c.restoreState()


def arrow(c, x1, y1, x2, y2, color=FLOW, width=1.6, head=7.0, dash=None):
    c.saveState()
    c.setStrokeColor(color)
    c.setLineWidth(width)
    c.setLineCap(1)
    if dash:
        c.setDash(*dash)
    ang = math.atan2(y2 - y1, x2 - x1)
    # stop the line just short of the tip so the head stays crisp
    lx = x2 - math.cos(ang) * head * 0.7
    ly = y2 - math.sin(ang) * head * 0.7
    c.line(x1, y1, lx, ly)
    c.restoreState()
    arrowhead(c, x2, y2, ang, head, color)


def elbow(c, pts, color=FLOW, width=1.6, head=7.0, dash=None):
    """Polyline through pts with an arrowhead on the final segment."""
    c.saveState()
    c.setStrokeColor(color)
    c.setLineWidth(width)
    c.setLineCap(1)
    c.setLineJoin(1)
    if dash:
        c.setDash(*dash)
    (x2, y2), (x1, y1) = pts[-1], pts[-2]
    ang = math.atan2(y2 - y1, x2 - x1)
    p = c.beginPath()
    p.moveTo(*pts[0])
    for pt in pts[1:-1]:
        p.lineTo(*pt)
    p.lineTo(x2 - math.cos(ang) * head * 0.7, y2 - math.sin(ang) * head * 0.7)
    c.drawPath(p, fill=0, stroke=1)
    c.restoreState()
    arrowhead(c, x2, y2, ang, head, color)


def dot_grid(c, x0, y0, x1, y1, gap=26, r=0.7):
    c.setFillColor(GRID_DOT)
    y = y0
    while y <= y1:
        x = x0
        while x <= x1:
            c.circle(x, y, r, fill=1, stroke=0)
            x += gap
        y += gap


def num_badge(c, cx, cy, n, r=9, fill=ORANGE, txt=WHITE, size=8.5):
    c.setFillColor(fill)
    c.circle(cx, cy, r, fill=1, stroke=0)
    ctext(c, cx, cy - size * 0.36, str(n), FB, size, txt)


def chip(c, cx, cy, label, w=None, h=13, dot=True):
    """Small role pill centered at (cx, cy)."""
    tw = stringWidth(label, FB, 5.8)
    w = w or (tw + (16 if dot else 10) + 6)
    rrect(c, cx - w / 2, cy - h / 2, w, h, r=h / 2, fill=colors.HexColor("#2A2A2A"),
          stroke=colors.HexColor("#4A4A4A"), sw=0.7)
    tx = cx - w / 2 + (13 if dot else (w - tw) / 2)
    if dot:
        c.setFillColor(ORANGE)
        c.circle(cx - w / 2 + 7.5, cy, 2.1, fill=1, stroke=0)
    c.setFont(FB, 5.8)
    c.setFillColor(OFFWHT)
    c.drawString(tx, cy - 2.1, label)


def check_mark(c, cx, cy, s=8, color=WHITE, width=2.6):
    c.saveState()
    c.setStrokeColor(color)
    c.setLineWidth(width)
    c.setLineCap(1)
    c.setLineJoin(1)
    p = c.beginPath()
    p.moveTo(cx - s * 0.55, cy - s * 0.05)
    p.lineTo(cx - s * 0.12, cy - s * 0.45)
    p.lineTo(cx + s * 0.62, cy + s * 0.45)
    c.drawPath(p, fill=0, stroke=1)
    c.restoreState()


def diamond(c, cx, cy, w, h, lines, fill=CARD, stroke=ORANGE, sw=1.2,
            font=FB, size=7.4, color=WHITE):
    p = c.beginPath()
    p.moveTo(cx, cy + h / 2)
    p.lineTo(cx + w / 2, cy)
    p.lineTo(cx, cy - h / 2)
    p.lineTo(cx - w / 2, cy)
    p.close()
    c.setFillColor(fill)
    c.setStrokeColor(stroke)
    c.setLineWidth(sw)
    c.drawPath(p, fill=1, stroke=1)
    total = len(lines)
    y0 = cy + (total - 1) * (size + 1.5) / 2 - size * 0.36
    for i, ln in enumerate(lines):
        ctext(c, cx, y0 - i * (size + 1.5), ln, font, size, color)


# ── page chrome ───────────────────────────────────────────────────────────────
def page_bg(c, dots=True):
    c.setFillColor(PAGE_BG)
    c.rect(0, 0, W, H, fill=1, stroke=0)
    if dots:
        dot_grid(c, 30, 42, W - 30, H - 70)


def header(c, page_no):
    band_h = 46
    c.setFillColor(colors.HexColor("#1D1D1D"))
    c.rect(0, H - band_h, W, band_h, fill=1, stroke=0)
    c.setFillColor(ORANGE)
    c.rect(0, H - band_h - 3, W, 3, fill=1, stroke=0)
    # mark + wordmark
    mh = 26
    mw = mh * 1299 / 677
    c.drawImage(LOGO_MARK, 26, H - band_h + (band_h - mh) / 2, width=mw, height=mh,
                preserveAspectRatio=True, mask="auto")
    tx = 26 + mw + 10
    ltext(c, tx, H - 20, "PENNEY CONSTRUCTION, INC.", FB, 10.5, WHITE)
    ltext(c, tx, H - 32, "Residential General Contracting  ·  North Shore, MA", F, 6.6, LGRAY)
    rtext(c, W - 26, H - 20, "PROCESS MAP", FB, 9, ORANGE_HI)
    rtext(c, W - 26, H - 32, "How a job moves through Penney", F, 6.6, LGRAY)


def footer(c, page_no):
    c.setStrokeColor(LINE_DIM)
    c.setLineWidth(0.6)
    c.line(26, 30, W - 26, 30)
    ltext(c, 26, 19, "Penney Construction, Inc.  ·  North Shore, MA", F, 6.4, FAINT)
    rtext(c, W - 26, 19, f"Page {page_no} of {N_PAGES}", F, 6.4, LGRAY)


def page_title(c, num, title, sub):
    y = H - 78
    ltext(c, 34, y, num, FB, 26, ORANGE)
    tx = 34 + stringWidth(num, FB, 26) + 12
    ltext(c, tx, y, title, FB, 16.5, WHITE)
    ltext(c, tx + 1, y - 13, sub, F, 7.6, LGRAY)


# ── stage data ────────────────────────────────────────────────────────────────
PHASES = [
    ("WIN THE JOB",  "Stages 1–3", [
        (1, "Lead Intake", "new client reaches out"),
        (2, "Schedule It", "walkthrough on the calendar"),
        (3, "Walkthrough", "on site · photos · scope"),
    ]),
    ("PRICE IT", "Stages 4–6", [
        (4, "Estimating", "takeoff · pricing · proposal"),
        (5, "Owner Review", "Ryan signs off"),
        (6, "Client Review", "proposal sent · client OK"),
    ]),
    ("PAPERWORK", "Stages 7–8", [
        (7, "Permit & Deposit", "permit pulled · deposit in"),
        (8, "Job Package", "scope · subs · schedule"),
    ]),
    ("BUILD IT", "Stages 9–12", [
        (9, "PM Handoff", "field takes the folder"),
        (10, "Construction", "crew · subs · daily logs"),
        (11, "Rough Inspection", "town signs off rough"),
        (12, "Final Inspection", "town signs off final"),
    ]),
    ("CLOSE IT", "Stage 13", [
        (13, "Audit / Close-out", "punch list · final invoice"),
    ]),
]


# ── page 1: cover ─────────────────────────────────────────────────────────────
def page_cover(c):
    page_bg(c, dots=True)
    # orange frame bands
    c.setFillColor(ORANGE)
    c.rect(0, H - 5, W, 5, fill=1, stroke=0)
    c.rect(0, 0, W, 7, fill=1, stroke=0)

    # logo
    lw = 330
    lh = lw * 1210 / 2000
    c.drawImage(LOGO_FULL, (W - lw) / 2, 330, width=lw, height=lh,
                preserveAspectRatio=True, mask="auto")

    # title
    ctext(c, W / 2, 282, "THE PENNEY PROCESS", FB, 32, WHITE)
    c.setFillColor(ORANGE)
    c.rect(W / 2 - 62, 268, 124, 3.2, fill=1, stroke=0)
    ctext(c, W / 2, 246, "How a job moves from the first call to closed-out",
          F, 11, LGRAY)
    ctext(c, W / 2, 231, "13 stages  ·  5 phases  ·  one team", F, 8.5, FAINT)

    # phase strip
    n = len(PHASES)
    bw, bh, gap = 122, 40, 26
    total = n * bw + (n - 1) * gap
    x = (W - total) / 2
    y = 138
    for i, (name, stages, _) in enumerate(PHASES):
        rrect(c, x, y, bw, bh, r=8, fill=CARD, stroke=CARD_EDGE, sw=0.9)
        c.setFillColor(ORANGE)
        c.roundRect(x, y + bh - 4, bw, 4, 2, fill=1, stroke=0)
        ctext(c, x + bw / 2, y + bh / 2 - 0.5, name, FB, 8.8, WHITE)
        ctext(c, x + bw / 2, y + 7.5, stages, F, 6.2, LGRAY)
        if i < n - 1:
            arrow(c, x + bw + 4, y + bh / 2, x + bw + gap - 4, y + bh / 2,
                  color=ORANGE, width=2.4, head=8)
        x += bw + gap

    ctext(c, W / 2, 66, "PENNEY CONSTRUCTION, INC.", FB, 8, LGRAY)
    ctext(c, W / 2, 54, "Residential General Contracting  ·  North Shore, MA  ·  August 2026",
          F, 6.8, FAINT)


# ── page 2: pipeline at a glance ──────────────────────────────────────────────
def stage_card(c, x, y, w, h, n, label, caption, final=False):
    fill = ORANGE if final else CARD
    edge = ORANGE_HI if final else CARD_EDGE
    rrect(c, x, y, w, h, r=7, fill=fill, stroke=edge, sw=0.9)
    num_badge(c, x + 1, y + h - 1, n, r=8.5,
              fill=WHITE if final else ORANGE,
              txt=ORANGE if final else WHITE, size=8)
    cx = x + w / 2
    lab_lines = wrap(label, FB, 8.4, w - 14)
    cap_lines = wrap(caption, F, 6.2, w - 12) if caption else []
    block = len(lab_lines) * 10 + (3 + len(cap_lines) * 7.6 if cap_lines else 0)
    ty = y + h / 2 + block / 2 - 8
    for ln in lab_lines:
        ctext(c, cx, ty, ln, FB, 8.4, WHITE)
        ty -= 10
    ty -= 1.5
    for ln in cap_lines:
        ctext(c, cx, ty, ln, F, 6.2,
              colors.HexColor("#FFD9C4") if final else LGRAY)
        ty -= 7.6

def page_pipeline(c):
    page_bg(c)
    header(c, 2)
    footer(c, 2)
    page_title(c, "01", "THE PIPELINE AT A GLANCE",
               "Every job runs the same 13 stages — grouped into 5 phases, left to right.")

    margin = 34
    gap_col = 32
    n = len(PHASES)
    col_w = (W - margin * 2 - gap_col * (n - 1)) / n
    top = H - 118
    head_h = 30
    card_h, card_gap = 74, 20

    for i, (name, stages, items) in enumerate(PHASES):
        x = margin + i * (col_w + gap_col)
        cx = x + col_w / 2
        # phase header
        rrect(c, x, top - head_h, col_w, head_h, r=8, fill=ORANGE, stroke=None)
        ctext(c, cx, top - head_h / 2 + 1.5, name, FB, 9.6, WHITE)
        ctext(c, cx, top - head_h / 2 - 8.5, stages, F, 5.8, colors.HexColor("#FFD9C4"))
        # arrow to next phase
        if i < n - 1:
            ay = top - head_h / 2
            arrow(c, x + col_w + 3, ay, x + col_w + gap_col - 3, ay,
                  color=ORANGE, width=2.6, head=9)
        # stage cards
        y = top - head_h - 16
        for j, (num, label, cap) in enumerate(items):
            stage_card(c, x, y - card_h, col_w, card_h, num, label, cap)
            if j < len(items) - 1:
                arrow(c, cx, y - card_h - 2, cx, y - card_h - card_gap + 2,
                      color=FLOW, width=1.2, head=5.5)
            y -= card_h + card_gap
        # connector from header into first card
        arrow(c, cx, top - head_h - 3, cx, top - head_h - 13.5,
              color=FLOW, width=1.2, head=5.5)
        # done badge under the close column
        if i == n - 1:
            by = y - 62
            arrow(c, cx, y - 2, cx, by + 27, color=ORANGE, width=1.8, head=7)
            c.setFillColor(ORANGE)
            c.circle(cx, by, 24, fill=1, stroke=0)
            c.setStrokeColor(ORANGE_HI)
            c.setLineWidth(1.2)
            c.circle(cx, by, 24, fill=0, stroke=1)
            check_mark(c, cx, by + 4, s=10)
            ctext(c, cx, by - 15.5, "DONE", FB, 7, WHITE)


# ── pages 3 & 4 shared flow renderer ─────────────────────────────────────────
def flow_card(c, cx, cy, w, h, title, caption, final=False, role=None,
              role_pos="bottom"):
    fill = ORANGE if final else CARD
    rrect(c, cx - w / 2, cy - h / 2, w, h, r=7, fill=fill,
          stroke=ORANGE_HI if final else CARD_EDGE, sw=0.9)
    lab_lines = wrap(title, FB, 8.2, w - 12)
    cap_lines = wrap(caption, F, 6.2, w - 10) if caption else []
    block = len(lab_lines) * 9.6 + (3 + len(cap_lines) * 7.4 if cap_lines else 0)
    ty = cy + block / 2 - 7.5
    for ln in lab_lines:
        ctext(c, cx, ty, ln, FB, 8.2, WHITE)
        ty -= 9.6
    ty -= 1.5
    for ln in cap_lines:
        ctext(c, cx, ty, ln, F, 6.2,
              colors.HexColor("#FFD9C4") if final else LGRAY)
        ty -= 7.4
    if role:
        ry = cy - h / 2 - 10 if role_pos == "bottom" else cy + h / 2 + 10
        chip(c, cx, ry, role)


def principle(c, y, msg):
    tw = stringWidth(msg, FB, 8.4)
    x0 = (W - tw) / 2
    c.setFillColor(ORANGE)
    c.rect(x0 - 12, y - 2.2, 3.2, 11, fill=1, stroke=0)
    ltext(c, x0, y, msg, FB, 8.4, OFFWHT)


# ── page 3: lead -> contract ─────────────────────────────────────────────────
def page_lead_to_contract(c):
    page_bg(c)
    header(c, 3)
    footer(c, 3)
    page_title(c, "02", "FROM LEAD TO SIGNED CONTRACT",
               "Phases 1–3 in detail — every proposal loops until the owner and the client both say yes.")

    margin = 40
    cw, ch = 120, 56
    dw, dh = 104, 76
    gap = (W - margin * 2 - cw * 5) / 4
    xs = [margin + cw / 2 + i * (cw + gap) for i in range(5)]
    y1, y2 = 400, 215

    row1 = [
        ("Client Reaches Out", "call · email · referral", "SHANNON", "bottom"),
        ("Lead Logged", "project opened in the system", "SHANNON", "bottom"),
        ("Walkthrough Scheduled", "date confirmed with client", "JORGE", "bottom"),
        ("On-Site Walkthrough", "photos · measurements · scope", "JORGE", "bottom"),
        ("Estimate Built", "takeoff · pricing · proposal", "JORGE", "top"),
    ]
    for i, (t, cap, role, rp) in enumerate(row1):
        flow_card(c, xs[i], y1, cw, ch, t, cap, role=role, role_pos=rp)
        if i < 4:
            arrow(c, xs[i] + cw / 2 + 3, y1, xs[i + 1] - cw / 2 - 3, y1,
                  color=FLOW, width=1.7, head=7)

    # estimate drops down and feeds the owner diamond from the right
    elbow(c, [(xs[4], y1 - ch / 2 - 3), (xs[4], y2), (xs[3] + dw / 2 + 3, y2)],
          color=FLOW, width=1.7, head=7)

    # row 2 (flows right -> left)
    diamond(c, xs[3], y2, dw, dh, ["OWNER", "SIGNS OFF?"])
    chip(c, xs[3], y2 - dh / 2 - 11, "RYAN")

    arrow(c, xs[3] - dw / 2 - 3, y2, xs[2] + cw / 2 + 3, y2,
          color=FLOW, width=1.7, head=7)
    ctext(c, (xs[3] - dw / 2 + xs[2] + cw / 2) / 2, y2 + 6, "YES", FB, 6.4, OFFWHT)

    flow_card(c, xs[2], y2, cw, ch, "Proposal to Client",
              "sent for review + e-sign", role="JORGE")

    arrow(c, xs[2] - cw / 2 - 3, y2, xs[1] + dw / 2 + 3, y2,
          color=FLOW, width=1.7, head=7)

    diamond(c, xs[1], y2, dw, dh, ["CLIENT", "SIGNS?"])
    chip(c, xs[1], y2 - dh / 2 - 11, "CLIENT")

    arrow(c, xs[1] - dw / 2 - 3, y2, xs[0] + cw / 2 + 3, y2,
          color=FLOW, width=1.7, head=7)
    ctext(c, (xs[1] - dw / 2 + xs[0] + cw / 2) / 2, y2 + 6, "YES", FB, 6.4, OFFWHT)

    flow_card(c, xs[0], y2, cw, ch + 4, "CONTRACT SIGNED",
              "deposit in · price locked · job is on", final=True, role="NICOLE")

    # loop-backs (dashed orange) — both land back on the estimate card
    band_o, band_c = 330, 348
    elbow(c, [(xs[3], y2 + dh / 2 + 2), (xs[3], band_o),
              (xs[4] - 20, band_o), (xs[4] - 20, y1 - ch / 2 - 4)],
          color=ORANGE, width=1.3, head=6.5, dash=(3, 3))
    ctext(c, (xs[3] + xs[4] - 20) / 2, band_o + 5, "NO — REVISE", FB, 6.0, ORANGE_HI)

    elbow(c, [(xs[1], y2 + dh / 2 + 2), (xs[1], band_c),
              (xs[4] - 44, band_c), (xs[4] - 44, y1 - ch / 2 - 4)],
          color=ORANGE, width=1.3, head=6.5, dash=(3, 3))
    ctext(c, (xs[1] + xs[2]) / 2, band_c + 5, "NO — REVISE & RESEND",
          FB, 6.0, ORANGE_HI)

    principle(c, 96, "NOTHING GETS BUILT UNTIL THE PRICE IS SIGNED")


# ── page 4: permit -> done ───────────────────────────────────────────────────
def page_build(c):
    page_bg(c)
    header(c, 4)
    footer(c, 4)
    page_title(c, "03", "FROM PERMIT TO DONE",
               "Phases 4–5 in detail — nothing moves past an inspection until the town signs off.")

    margin = 40
    cw, ch = 120, 56
    dw, dh = 104, 76
    gap = (W - margin * 2 - cw * 5) / 4
    xs = [margin + cw / 2 + i * (cw + gap) for i in range(5)]
    y1, y2 = 415, 235

    row1 = [
        ("Permit & Deposit", "permit pulled · deposit banked", "NICOLE"),
        ("Job Package", "scope · subs · budget · schedule", "JORGE"),
        ("PM Handoff", "field crew takes the folder", "HOWIE"),
        ("Construction", "crew · subs · materials · daily logs", "HOWIE"),
    ]
    for i, (t, cap, role) in enumerate(row1):
        flow_card(c, xs[i], y1, cw, ch, t, cap, role=role)
        arrow(c, xs[i] + cw / 2 + 3, y1,
              xs[i + 1] - (dw / 2 if i == 3 else cw / 2) - 3, y1,
              color=FLOW, width=1.7, head=7)

    # rough inspection diamond at the end of row 1
    diamond(c, xs[4], y1, dw, dh, ["ROUGH", "PASSES?"])

    # fail loop back into construction (over the top)
    loop_top = y1 + dh / 2 + 24
    elbow(c, [(xs[4], y1 + dh / 2 + 2), (xs[4], loop_top), (xs[3], loop_top),
              (xs[3], y1 + ch / 2 + 3)],
          color=ORANGE, width=1.3, head=6.5, dash=(3, 3))
    ctext(c, (xs[4] + xs[3]) / 2, loop_top + 5, "NO — FIX & RE-INSPECT",
          FB, 6.0, ORANGE_HI)

    # pass: straight down into finishes (chip drawn after, so it sits on the line)
    elbow(c, [(xs[4], y1 - dh / 2 - 2), (xs[4], y2 + ch / 2 + 3)],
          color=FLOW, width=1.7, head=7)
    chip(c, xs[4], y1 - dh / 2 - 11, "TOWN")
    ctext(c, xs[4] + 13, (y1 + y2) / 2 - 14, "YES", FB, 6.4, OFFWHT)

    # row 2 (flows right -> left)
    flow_card(c, xs[4], y2, cw, ch, "Finishes",
              "paint · trim · fixtures · floors", role="HOWIE")

    arrow(c, xs[4] - cw / 2 - 3, y2, xs[3] + dw / 2 + 3, y2,
          color=FLOW, width=1.7, head=7)

    diamond(c, xs[3], y2, dw, dh, ["FINAL", "PASSES?"])
    chip(c, xs[3], y2 - dh / 2 - 11, "TOWN")

    # final-fail loop back into finishes
    lt2 = y2 + dh / 2 + 22
    elbow(c, [(xs[3], y2 + dh / 2 + 2), (xs[3], lt2), (xs[4] - 26, lt2),
              (xs[4] - 26, y2 + ch / 2 + 3)],
          color=ORANGE, width=1.3, head=6.5, dash=(3, 3))
    ctext(c, (xs[3] + xs[4] - 26) / 2, lt2 + 5, "NO", FB, 6.0, ORANGE_HI)

    arrow(c, xs[3] - dw / 2 - 3, y2, xs[2] + cw / 2 + 3, y2,
          color=FLOW, width=1.7, head=7)
    ctext(c, (xs[3] - dw / 2 + xs[2] + cw / 2) / 2, y2 + 6, "YES", FB, 6.4, OFFWHT)

    flow_card(c, xs[2], y2, cw, ch, "Punch List",
              "client walkthrough · last fixes", role="HOWIE")

    arrow(c, xs[2] - cw / 2 - 3, y2, xs[1] + cw / 2 + 3, y2,
          color=FLOW, width=1.7, head=7)

    flow_card(c, xs[1], y2, cw, ch, "Audit & Close-out",
              "final invoice · books closed", role="RYAN")

    # done badge at far left
    bx = xs[0]
    arrow(c, xs[1] - cw / 2 - 3, y2, bx + 27, y2, color=ORANGE, width=2.2, head=8)
    c.setFillColor(ORANGE)
    c.circle(bx, y2, 24, fill=1, stroke=0)
    c.setStrokeColor(ORANGE_HI)
    c.setLineWidth(1.2)
    c.circle(bx, y2, 24, fill=0, stroke=1)
    check_mark(c, bx, y2 + 4, s=10)
    ctext(c, bx, y2 - 15.5, "DONE", FB, 7, WHITE)
    ctext(c, bx, y2 - 24 - 13, "JOB CLOSED", FB, 6.2, LGRAY)

    principle(c, 110, "THE TOWN SIGNS OFF TWICE — NO SHORTCUTS PAST AN INSPECTION")


# ── page 5: swimlane ─────────────────────────────────────────────────────────
STAGE_KEY = ("1 Lead   2 Schedule   3 Walkthrough   4 Estimate   5 Owner OK   "
             "6 Client OK   7 Permit + Deposit   8 Job Package   9 Handoff   "
             "10 Build   11 Rough   12 Final   13 Close-out")

LANES = [
    ("CLIENT",  "the homeowner",            [6],              [1, 3, 13]),
    ("SHANNON", "intake",                   [1],              [2]),
    ("JORGE",   "precon · estimating",      [2, 3, 4],        [5, 6, 7, 8]),
    ("RYAN",    "owner",                    [5, 13],          [6, 10]),
    ("NICOLE",  "office · permits",         [7],              [8, 13]),
    ("HOWIE",   "field",                    [9, 10, 11, 12],  []),
]

def group_runs(nums):
    runs, start, prev = [], None, None
    for n in sorted(nums):
        if start is None:
            start = prev = n
        elif n == prev + 1:
            prev = n
        else:
            runs.append((start, prev))
            start = prev = n
    if start is not None:
        runs.append((start, prev))
    return runs

def page_swimlane(c):
    page_bg(c, dots=False)
    header(c, 5)
    footer(c, 5)
    page_title(c, "04", "WHO RUNS WHAT",
               "Same 13 stages — solid means they lead it, outlined means they back it up.")

    left = 172
    right = W - 40
    col_w = (right - left) / 13
    top = H - 128
    lane_h = 58
    lanes_top = top - 24

    # column header: numbered circles
    for i in range(13):
        cx = left + col_w * (i + 0.5)
        num_badge(c, cx, top, i + 1, r=8.2, size=7.8)

    # lanes
    for li, (name, sub, leads, supports) in enumerate(LANES):
        y0 = lanes_top - (li + 1) * lane_h
        if li % 2 == 0:
            c.setFillColor(colors.HexColor("#282828"))
            c.rect(34, y0, right - 34, lane_h, fill=1, stroke=0)
        c.setStrokeColor(LINE_DIM)
        c.setLineWidth(0.5)
        c.line(34, y0, right, y0)
        ltext(c, 42, y0 + lane_h / 2 + 2, name, FB, 9.5, WHITE)
        ltext(c, 42, y0 + lane_h / 2 - 8.5, sub, F, 6.4, LGRAY)

        cy = y0 + lane_h / 2
        bar_h = 15
        for a, b in group_runs(leads):
            x0 = left + col_w * (a - 1) + 4
            x1 = left + col_w * b - 4
            rrect(c, x0, cy - bar_h / 2, x1 - x0, bar_h, r=bar_h / 2,
                  fill=ORANGE, stroke=None)
        for a, b in group_runs(supports):
            x0 = left + col_w * (a - 1) + 4
            x1 = left + col_w * b - 4
            rrect(c, x0, cy - bar_h / 2, x1 - x0, bar_h, r=bar_h / 2,
                  fill=None, stroke=colors.HexColor("#8A5A44"), sw=1.1)

    bottom = lanes_top - len(LANES) * lane_h
    c.setStrokeColor(LINE_DIM)
    c.setLineWidth(0.5)
    c.line(34, bottom, right, bottom)

    # faint column guides
    c.setStrokeColor(colors.HexColor("#2E2E2E"))
    c.setLineWidth(0.4)
    for i in range(14):
        x = left + col_w * i
        c.line(x, bottom, x, lanes_top)

    # legend
    ly = bottom - 18
    rrect(c, left, ly - 6, 30, 12, r=6, fill=ORANGE, stroke=None)
    ltext(c, left + 36, ly - 3, "LEADS IT", FB, 6.6, OFFWHT)
    lx2 = left + 96
    rrect(c, lx2, ly - 6, 30, 12, r=6, fill=None,
          stroke=colors.HexColor("#8A5A44"), sw=1.1)
    ltext(c, lx2 + 36, ly - 3, "BACKS IT UP", FB, 6.6, OFFWHT)

    ctext(c, W / 2, 40, STAGE_KEY, F, 6.2, FAINT)


# ── build ────────────────────────────────────────────────────────────────────
def main():
    c = rl_canvas.Canvas(OUT, pagesize=(W, H))
    c.setTitle("Penney Construction — The Penney Process")
    c.setAuthor("Penney Construction, Inc.")
    c.setSubject("Process map: lead intake to project close-out")

    page_cover(c);            c.showPage()
    page_pipeline(c);         c.showPage()
    page_lead_to_contract(c); c.showPage()
    page_build(c);            c.showPage()
    page_swimlane(c);         c.showPage()
    c.save()
    print("wrote", OUT, os.path.getsize(OUT), "bytes")


if __name__ == "__main__":
    main()
