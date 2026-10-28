"""
Survival Atlas - motor de mapas animados (offline).
Renderiza cenas de mapa em MP4 1920x1080 a partir de uma spec em dicionario.

Tipos de cena:
  zoom      : mundo -> regiao, destacando paises/areas
  route     : rota animada (lista de pontos lat/lon) com marcadores
  territory : destaca territorios com rotulos e datas (aparecem em sequencia)
  counter   : numero animado grande sobre o mapa (ex.: dias de noite polar)
  compare   : barras comparando 2 a 4 valores sobre fundo de mapa

Uso: render_scene(spec, out_path, duration=8, fps=30)
"""
import math, subprocess, warnings
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch
import geopandas as gpd

warnings.filterwarnings("ignore")

W, H = 1920, 1080
STYLE = {
    "sea": "#1d2b36",
    "land": "#d9c7a0",
    "land_edge": "#8c7a55",
    "highlight": "#c0552a",
    "highlight2": "#e0a94a",
    "route": "#f2e3c0",
    "text": "#f5ecd7",
    "shadow": "#0b1218",
    "font": "DejaVu Serif",
}

_WORLD = {}
def world(crs=None, clip=None):
    """Mapa-mundi offline, opcionalmente recortado (lon0,lon1,lat0,lat1) e reprojetado
    (ex.: '+proj=lcc +lat_1=50 +lat_2=75 +lon_0=-15'). O recorte evita poligonos
    gigantes (Antartida, Russia) virarem lixo na projecao."""
    key = (crs or "EPSG:4326", tuple(clip) if clip else None)
    if key not in _WORLD:
        w = gpd.read_file(gpd.datasets.get_path("naturalearth_lowres"))
        if clip:
            from shapely.geometry import box
            lon0, lon1, lat0, lat1 = clip
            w = gpd.clip(w, box(lon0, lat0, lon1, lat1))
        if crs:
            w = w.to_crs(crs)
        _WORLD[key] = w
    return _WORLD[key]

def _clip_for(spec):
    """Caixa lon/lat de recorte com folga, a partir do extent/end da cena."""
    if not spec.get("crs"):
        return None
    e = spec.get("extent") or spec.get("end")
    lon0, lon1, lat0, lat1 = e
    mw, mh = (lon1 - lon0) * 0.6, (lat1 - lat0) * 0.6
    return (max(lon0 - mw, -179.9), min(lon1 + mw, 179.9), max(lat0 - mh, -89), min(lat1 + mh, 89))

class Proj:
    """Converte lon/lat -> coordenadas do mapa. Sem crs, e identidade."""
    def __init__(self, crs=None):
        self.crs = crs
        if crs:
            from pyproj import Transformer
            self.t = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
    def xy(self, lon, lat):
        return self.t.transform(lon, lat) if self.crs else (lon, lat)
    def ext(self, e):
        """(lon0,lon1,lat0,lat1) -> extent projetado (amostra a borda)."""
        if not self.crs:
            return tuple(e)
        lon0, lon1, lat0, lat1 = e
        xs, ys = [], []
        for lon in np.linspace(lon0, lon1, 12):
            for lat in (lat0, lat1):
                x, y = self.xy(lon, lat); xs.append(x); ys.append(y)
        for lat in np.linspace(lat0, lat1, 12):
            for lon in (lon0, lon1):
                x, y = self.xy(lon, lat); xs.append(x); ys.append(y)
        return (min(xs), max(xs), min(ys), max(ys))

def ease(t):  # ease in-out
    return 0.5 - 0.5 * math.cos(math.pi * min(max(t, 0), 1))

def _fig():
    fig = plt.figure(figsize=(W / 100, H / 100), dpi=100, facecolor=STYLE["sea"])
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_facecolor(STYLE["sea"])
    ax.set_xticks([]); ax.set_yticks([])
    for s in ax.spines.values():
        s.set_visible(False)
    return fig, ax

def _draw_world(ax, highlight=None, crs=None, clip=None):
    w = world(crs, clip)
    w.plot(ax=ax, color=STYLE["land"], edgecolor=STYLE["land_edge"], linewidth=0.6)
    if highlight:
        sel = w[w["name"].isin(highlight)]
        sel.plot(ax=ax, color=STYLE["highlight"], edgecolor=STYLE["land_edge"], linewidth=0.6, alpha=0.9)
    ax.set_aspect("auto")  # geopandas forca 'equal'; o enquadramento 16:9 e feito em _set_extent

def _set_extent(ax, ext, projected=False):
    """ext = (x_min, x_max, y_min, y_max); corrige para 16:9."""
    lon0, lon1, lat0, lat1 = ext
    cx, cy = (lon0 + lon1) / 2, (lat0 + lat1) / 2
    lat_scale = 1.0 if projected else 1 / max(math.cos(math.radians(cy)), 0.2)
    half_h = (lat1 - lat0) / 2
    half_w = (lon1 - lon0) / 2
    need_w = half_h * (W / H) / lat_scale
    if need_w > half_w:
        half_w = need_w
    else:
        half_h = half_w * lat_scale / (W / H)
    ax.set_xlim(cx - half_w, cx + half_w)
    ax.set_ylim(cy - half_h, cy + half_h)

def _title(ax, text, y=0.92, size=44):
    if not text:
        return None
    return ax.text(0.5, y, text, transform=ax.transAxes, ha="center", va="center",
                   fontsize=size, fontfamily=STYLE["font"], fontweight="bold", color=STYLE["text"],
                   path_effects=_pe())

def _pe():
    import matplotlib.patheffects as pe
    return [pe.withStroke(linewidth=5, foreground=STYLE["shadow"])]

def _label(ax, lon, lat, text, size=26, color=None, dy=0.0):
    return ax.text(lon, lat + dy, text, ha="center", va="bottom", fontsize=size,
                   fontfamily=STYLE["font"], fontweight="bold",
                   color=color or STYLE["text"], path_effects=_pe(), zorder=20)

def _interp_ext(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(4))

def _ffmpeg_writer(out_path, fps):
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
           "-s", f"{W}x{H}", "-r", str(fps), "-i", "-", "-an",
           "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", out_path]
    return subprocess.Popen(cmd, stdin=subprocess.PIPE)

def _frame(fig):
    fig.canvas.draw()
    buf = np.asarray(fig.canvas.buffer_rgba())[:, :, :3]
    return buf.tobytes()

# ---------------------------------------------------------------- scenes
def render_scene(spec, out_path, duration=8.0, fps=30):
    kind = spec["kind"]
    n = int(duration * fps)
    crs = spec.get("crs")
    P = Proj(crs)
    projected = bool(crs)
    dy = spec.get("label_dy", 0.8) * (110000 if projected else 1)  # deslocamento do rotulo (m ou graus)
    clip = _clip_for(spec)
    fig, ax = _fig()
    proc = _ffmpeg_writer(out_path, fps)
    try:
        if kind == "zoom":
            _draw_world(ax, spec.get("highlight"), crs, clip)
            start = P.ext(spec.get("start", (-180, 180, -60, 85)))
            end = P.ext(spec["end"])
            title = _title(ax, spec.get("title"))
            labels = [(_label(ax, *P.xy(l[0], l[1]), l[2]), l) for l in spec.get("labels", [])]
            for lb, _ in labels: lb.set_alpha(0)
            for i in range(n):
                t = i / max(n - 1, 1)
                k = ease(min(t / 0.65, 1))          # zoom nos primeiros 65%
                _set_extent(ax, _interp_ext(start, end, k), projected)
                a = ease((t - 0.6) / 0.25)
                for lb, _ in labels: lb.set_alpha(a)
                proc.stdin.write(_frame(fig))

        elif kind == "route":
            _draw_world(ax, spec.get("highlight"), crs, clip)
            _set_extent(ax, P.ext(spec["extent"]), projected)
            title = _title(ax, spec.get("title"))
            pts = np.array([P.xy(*p) for p in spec["points"]], dtype=float)
            # densifica
            dense = []
            for a, b in zip(pts[:-1], pts[1:]):
                for s in np.linspace(0, 1, 60, endpoint=False):
                    dense.append(a + (b - a) * s)
            dense.append(pts[-1]); dense = np.array(dense)
            line, = ax.plot([], [], color=STYLE["route"], lw=5, zorder=15,
                            path_effects=_pe(), solid_capstyle="round")
            head, = ax.plot([], [], "o", color=STYLE["highlight2"], ms=16, zorder=16,
                            markeredgecolor=STYLE["shadow"], markeredgewidth=2)
            stops = spec.get("stops", [])  # [[lon,lat,"texto"],...]
            stop_lbls = []
            for s in stops:
                sx, sy = P.xy(s[0], s[1])
                ax.plot(sx, sy, "o", color=STYLE["highlight2"], ms=11, zorder=17,
                        markeredgecolor=STYLE["shadow"], markeredgewidth=2)
                lb = _label(ax, sx, sy, s[2], size=24, dy=dy)
                lb.set_alpha(0); stop_lbls.append((lb, np.array([sx, sy], dtype=float)))
            near = dy * 0.7
            for i in range(n):
                t = i / max(n - 1, 1)
                k = ease(min(t / 0.85, 1))
                m = max(int(k * (len(dense) - 1)), 1)
                line.set_data(dense[:m + 1, 0], dense[:m + 1, 1])
                head.set_data([dense[m, 0]], [dense[m, 1]])
                reached = dense[:m + 1]
                for lb, p in stop_lbls:
                    if np.min(np.linalg.norm(reached - p, axis=1)) < near:
                        lb.set_alpha(min(lb.get_alpha() + 0.08, 1))
                proc.stdin.write(_frame(fig))

        elif kind == "territory":
            _draw_world(ax, spec.get("highlight"), crs, clip)
            _set_extent(ax, P.ext(spec["extent"]), projected)
            title = _title(ax, spec.get("title"))
            items = spec["items"]  # [[lon,lat,"Texto","subtexto"],...] aparecem em sequencia
            arts = []
            for it in items:
                ix, iy = P.xy(it[0], it[1])
                dot, = ax.plot(ix, iy, "o", color=STYLE["highlight2"], ms=18, zorder=16,
                               markeredgecolor=STYLE["shadow"], markeredgewidth=2)
                below = len(it) > 4 and it[4] == "below"   # rotulo abaixo do ponto (evita sobreposicao)
                if below:
                    t1 = ax.text(ix, iy - dy * 0.6, it[2], ha="center", va="top", fontsize=28,
                                 fontfamily=STYLE["font"], fontweight="bold", color=STYLE["text"],
                                 path_effects=_pe(), zorder=20)
                    t2 = ax.text(ix, iy - dy * 1.9, it[3] if len(it) > 3 else "", ha="center", va="top",
                                 fontsize=22, fontfamily=STYLE["font"], color=STYLE["highlight2"],
                                 path_effects=_pe(), zorder=20)
                else:
                    t1 = _label(ax, ix, iy, it[2], size=28, dy=dy)
                    t2 = ax.text(ix, iy - dy * 0.9, it[3] if len(it) > 3 else "",
                                 ha="center", va="top", fontsize=22, fontfamily=STYLE["font"],
                                 color=STYLE["highlight2"], path_effects=_pe(), zorder=20)
                for a_ in (dot, t1, t2): a_.set_alpha(0)
                arts.append((dot, t1, t2))
            for i in range(n):
                t = i / max(n - 1, 1)
                for j, group in enumerate(arts):
                    t0 = 0.12 + j * (0.7 / max(len(arts), 1))
                    a = ease((t - t0) / 0.12)
                    for a_ in group: a_.set_alpha(a)
                proc.stdin.write(_frame(fig))

        elif kind == "counter":
            _draw_world(ax, spec.get("highlight"), crs, clip)
            _set_extent(ax, P.ext(spec["extent"]), projected)
            title = _title(ax, spec.get("title"), y=0.9)
            box = FancyBboxPatch((0.25, 0.3), 0.5, 0.36, boxstyle="round,pad=0.02,rounding_size=0.02",
                                 transform=ax.transAxes, fc=STYLE["shadow"], ec=STYLE["highlight2"],
                                 lw=3, alpha=0.85, zorder=30)
            ax.add_patch(box)
            num = ax.text(0.5, 0.52, "", transform=ax.transAxes, ha="center", va="center",
                          fontsize=110, fontfamily=STYLE["font"], fontweight="bold",
                          color=STYLE["highlight2"], zorder=31)
            sub = ax.text(0.5, 0.37, spec.get("label", ""), transform=ax.transAxes, ha="center",
                          va="center", fontsize=34, fontfamily=STYLE["font"], color=STYLE["text"], zorder=31)
            v0, v1 = spec.get("from", 0), spec["to"]
            fmt = spec.get("fmt", "{:,.0f}")
            suffix = spec.get("suffix", "")
            for i in range(n):
                t = i / max(n - 1, 1)
                k = ease(min(t / 0.7, 1))
                num.set_text(fmt.format(v0 + (v1 - v0) * k) + suffix)
                proc.stdin.write(_frame(fig))

        elif kind == "compare":
            _draw_world(ax, spec.get("highlight"), crs, clip)
            _set_extent(ax, P.ext(spec["extent"]), projected)
            title = _title(ax, spec.get("title"), y=0.9)
            items = spec["items"]  # [["Rotulo", valor], ...]
            vmax = max(v for _, v in items)
            box = FancyBboxPatch((0.12, 0.12), 0.76, 0.64, boxstyle="round,pad=0.02,rounding_size=0.02",
                                 transform=ax.transAxes, fc=STYLE["shadow"], ec=STYLE["highlight2"],
                                 lw=3, alpha=0.85, zorder=30)
            ax.add_patch(box)
            bars, vals = [], []
            rows = len(items)
            for j, (lab, v) in enumerate(items):
                y = 0.66 - j * (0.5 / rows)
                ax.text(0.16, y, lab, transform=ax.transAxes, ha="left", va="center", fontsize=30,
                        fontfamily=STYLE["font"], color=STYLE["text"], zorder=31)
                b = FancyBboxPatch((0.42, y - 0.03), 0.0001, 0.06, boxstyle="round,pad=0.005",
                                   transform=ax.transAxes, fc=STYLE["highlight"] if j == 0 else STYLE["highlight2"],
                                   ec="none", zorder=31)
                ax.add_patch(b); bars.append((b, v))
                vals.append(ax.text(0.43, y, "", transform=ax.transAxes, ha="left", va="center",
                                    fontsize=28, fontfamily=STYLE["font"], fontweight="bold",
                                    color=STYLE["text"], zorder=32))
            unit = spec.get("unit", "")
            for i in range(n):
                t = i / max(n - 1, 1)
                k = ease(min(t / 0.7, 1))
                for (b, v), vt in zip(bars, vals):
                    wdt = 0.40 * (v / vmax) * k
                    b.set_width(max(wdt, 0.0001))
                    vt.set_text(f"{v * k:,.0f}{unit}")
                    vt.set_x(0.43 + wdt + 0.01)
                proc.stdin.write(_frame(fig))
        else:
            raise ValueError(f"kind desconhecido: {kind}")
    finally:
        proc.stdin.close(); proc.wait()
        plt.close(fig)
    return out_path
