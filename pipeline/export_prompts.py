"""
Exporta os prompts de imagem do episodio para gerar na Magnific (pelo Estudio Bru ou manualmente).
Uso: python pipeline/export_prompts.py 01-vikings-arctic-winter
Gera episodes/<slug>/images/prompts.csv e prompts.txt
Nomeie as imagens geradas como scene_03_1.png, scene_03_2.png (cena, indice) na pasta images/.
Aspecto 16:9, minimo 1920x1080. Para o personagem guia, gere 1 imagem de referencia primeiro
e use como referencia de personagem (character reference) nas demais.
"""
import csv, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import load_script, ep_dir, fill_prompt

def main():
    slug = sys.argv[1]
    data = load_script(slug)
    out = ep_dir(slug, "images")
    rows = []
    for sc in data["scenes"]:
        for i, p in enumerate(sc.get("images", []), 1):
            rows.append((f"scene_{sc['id']:02d}_{i}.png", sc["type"], fill_prompt(p, data["style"])))
    with open(out / "prompts.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(["file", "type", "prompt"]); w.writerows(rows)
    with open(out / "prompts.txt", "w", encoding="utf-8") as f:
        for file, typ, p in rows:
            f.write(f"### {file} ({typ})\n{p}\n\n")
    print(f"{len(rows)} prompts -> {out/'prompts.csv'}")

if __name__ == "__main__":
    main()
