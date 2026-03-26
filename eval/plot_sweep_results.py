#!/usr/bin/env python3
"""Generate charts from search parameter sweep results."""

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import numpy as np
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parent
plt.style.use("dark_background")

COLORS = {
    "ndcg5": "#00D4AA",
    "mrr": "#7C8CF8",
    "hit3": "#FFB347",
    "best": "#FF6B6B",
    "bar1": "#00D4AA",
    "bar2": "#7C8CF8",
}


def setup_ax(ax, title, xlabel, ylabel):
    ax.set_title(title, fontsize=14, fontweight="bold", pad=12, color="white")
    ax.set_xlabel(xlabel, fontsize=11, color="#AAAAAA")
    ax.set_ylabel(ylabel, fontsize=11, color="#AAAAAA")
    ax.tick_params(colors="#888888")
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.spines["left"].set_color("#444444")
    ax.spines["bottom"].set_color("#444444")
    ax.set_facecolor("#1A1A2E")


# =========================================================================
# Chart 1: Candidate Multiplier Sweep
# =========================================================================
fig, ax = plt.subplots(figsize=(10, 5))
fig.patch.set_facecolor("#0F0F1A")

cand_mults = [4, 6, 8, 10, 12, 16, 20]
cand_ndcg = [0.7669, 0.7702, 0.7713, 0.7713, 0.7713, 0.7713, 0.7713]
cand_mrr = [0.8370, 0.8370, 0.8370, 0.8370, 0.8370, 0.8370, 0.8370]
cand_hit3 = [0.9121, 0.9121, 0.9121, 0.9121, 0.9121, 0.9121, 0.9121]

setup_ax(ax, "Phase 1: Candidate Pool Size (Embedding Mode)", "candidate_mult (limit = top_k × mult)", "Score")
ax.plot(cand_mults, cand_ndcg, "o-", color=COLORS["ndcg5"], linewidth=2, markersize=8, label="NDCG@5")
ax.plot(cand_mults, cand_mrr, "s-", color=COLORS["mrr"], linewidth=2, markersize=8, label="MRR")
ax.plot(cand_mults, cand_hit3, "^-", color=COLORS["hit3"], linewidth=2, markersize=8, label="Hit@3")
ax.axvline(x=8, color=COLORS["best"], linestyle="--", alpha=0.6, label="Best: 8x")
ax.set_ylim(0.70, 0.95)
ax.legend(loc="lower right", fontsize=10, framealpha=0.3)
ax.annotate("Plateaus at 8x — no benefit\nfrom larger candidate pools",
            xy=(12, 0.77), fontsize=9, color="#AAAAAA", style="italic")
fig.tight_layout()
fig.savefig(OUT_DIR / "sweep_1_candidate_mult.png", dpi=150)
plt.close()

# =========================================================================
# Chart 2: Rerank Top-N Sweep
# =========================================================================
fig, ax = plt.subplots(figsize=(10, 5))
fig.patch.set_facecolor("#0F0F1A")

rerank_ns = [5, 10, 15, 20, 25, 30, 40]
rerank_ndcg = [0.7627, 0.7553, 0.7902, 0.7936, 0.7937, 0.8000, 0.7866]
rerank_mrr = [0.8361, 0.8273, 0.8575, 0.8533, 0.8566, 0.8599, 0.8553]
rerank_hit3 = [0.8901, 0.8901, 0.9121, 0.9011, 0.9121, 0.9121, 0.9121]

setup_ax(ax, "Phase 2: Rerank Top-N (Jina Reranker v3)", "rerank_top_n", "Score")
ax.plot(rerank_ns, rerank_ndcg, "o-", color=COLORS["ndcg5"], linewidth=2.5, markersize=9, label="NDCG@5")
ax.plot(rerank_ns, rerank_mrr, "s-", color=COLORS["mrr"], linewidth=2.5, markersize=9, label="MRR")
ax.plot(rerank_ns, rerank_hit3, "^-", color=COLORS["hit3"], linewidth=2.5, markersize=9, label="Hit@3")
ax.axvline(x=30, color=COLORS["best"], linestyle="--", alpha=0.6, label="Best: 30")

# Highlight the dip at n=10
ax.annotate("Dip: too few candidates\nfor reranker to choose from",
            xy=(10, 0.755), xytext=(14, 0.74),
            arrowprops=dict(arrowstyle="->", color="#FF6B6B", lw=1.5),
            fontsize=9, color="#FF6B6B")
ax.annotate("Peak at n=30",
            xy=(30, 0.800), xytext=(34, 0.81),
            arrowprops=dict(arrowstyle="->", color=COLORS["best"], lw=1.5),
            fontsize=9, color=COLORS["best"])

ax.set_ylim(0.72, 0.94)
ax.legend(loc="lower right", fontsize=10, framealpha=0.3)
fig.tight_layout()
fig.savefig(OUT_DIR / "sweep_2_rerank_top_n.png", dpi=150)
plt.close()

# =========================================================================
# Chart 3: MMR Lambda Sweep
# =========================================================================
fig, ax = plt.subplots(figsize=(10, 5))
fig.patch.set_facecolor("#0F0F1A")

mmr_lambdas = [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0]
mmr_ndcg = [0.7699, 0.7879, 0.7839, 0.7772, 0.7673, 0.7756, 0.7721, 0.7761, 0.7901]
mmr_mrr = [0.8223, 0.8443, 0.8443, 0.8333, 0.8245, 0.8300, 0.8300, 0.8355, 0.8516]
mmr_hit3 = [0.8791, 0.9011, 0.9011, 0.8901, 0.8791, 0.8791, 0.8791, 0.8791, 0.9121]

setup_ax(ax, "Phase 3: MMR Lambda (Diversity vs Relevance)", "mmr_lambda (1.0 = no MMR, lower = more diverse)", "Score")
ax.plot(mmr_lambdas, mmr_ndcg, "o-", color=COLORS["ndcg5"], linewidth=2.5, markersize=9, label="NDCG@5")
ax.plot(mmr_lambdas, mmr_mrr, "s-", color=COLORS["mrr"], linewidth=2.5, markersize=9, label="MRR")
ax.plot(mmr_lambdas, mmr_hit3, "^-", color=COLORS["hit3"], linewidth=2.5, markersize=9, label="Hit@3")
ax.axvline(x=1.0, color=COLORS["best"], linestyle="--", alpha=0.6, label="Best: 1.0 (no MMR)")
ax.annotate("MMR hurts recall —\ndiversity pushes correct\nresults out of top-K",
            xy=(0.8, 0.767), fontsize=9, color="#AAAAAA", style="italic")
ax.set_ylim(0.72, 0.94)
ax.legend(loc="lower left", fontsize=10, framealpha=0.3)
fig.tight_layout()
fig.savefig(OUT_DIR / "sweep_3_mmr_lambda.png", dpi=150)
plt.close()

# =========================================================================
# Chart 4: Cap Per Video Sweep
# =========================================================================
fig, ax = plt.subplots(figsize=(10, 5))
fig.patch.set_facecolor("#0F0F1A")

caps = [0, 1, 2, 3, 4]
cap_labels = ["None", "1", "2", "3", "4"]
cap_ndcg = [0.7817, 0.7870, 0.7905, 0.7813, 0.7912]
cap_mrr = [0.8397, 0.8502, 0.8493, 0.8397, 0.8544]
cap_hit3 = [0.8901, 0.8901, 0.9121, 0.8901, 0.9121]

setup_ax(ax, "Phase 4: Cap Per Video", "Max results per video (0 = no cap)", "Score")
x = np.arange(len(caps))
width = 0.25
bars1 = ax.bar(x - width, cap_ndcg, width, color=COLORS["ndcg5"], alpha=0.85, label="NDCG@5")
bars2 = ax.bar(x, cap_mrr, width, color=COLORS["mrr"], alpha=0.85, label="MRR")
bars3 = ax.bar(x + width, cap_hit3, width, color=COLORS["hit3"], alpha=0.85, label="Hit@3")
ax.set_xticks(x)
ax.set_xticklabels(cap_labels)
ax.set_ylim(0.72, 0.95)
ax.legend(fontsize=10, framealpha=0.3)
ax.annotate("No clear winner —\ncap has minimal impact",
            xy=(2, 0.93), fontsize=9, color="#AAAAAA", style="italic", ha="center")
fig.tight_layout()
fig.savefig(OUT_DIR / "sweep_4_cap_per_video.png", dpi=150)
plt.close()

# =========================================================================
# Chart 5: Final Comparison — Before vs After Optimization
# =========================================================================
fig, ax = plt.subplots(figsize=(10, 5))
fig.patch.set_facecolor("#0F0F1A")

categories = ["NDCG@5", "MRR", "Hit@3"]
# Before: v3.0 baseline from earlier eval (embedding only, old params)
before = [0.7256, 0.7138, 0.7830]
# After embedding optimized
after_emb = [0.7713, 0.8370, 0.9121]
# After rerank optimized
after_rerank = [0.8000, 0.8599, 0.9121]

x = np.arange(len(categories))
width = 0.22

setup_ax(ax, "Search Quality: Before vs After Optimization", "", "Score")
bars_before = ax.bar(x - width, before, width, color="#555555", alpha=0.8, label="Before (baseline)")
bars_emb = ax.bar(x, after_emb, width, color=COLORS["bar1"], alpha=0.85, label="After (embedding)")
bars_rerank = ax.bar(x + width, after_rerank, width, color=COLORS["bar2"], alpha=0.85, label="After (rerank)")

# Add value labels on bars
for bars in [bars_before, bars_emb, bars_rerank]:
    for bar in bars:
        height = bar.get_height()
        ax.text(bar.get_x() + bar.get_width()/2., height + 0.008,
                f'{height:.3f}', ha='center', va='bottom', fontsize=9, color="white")

# Add improvement arrows
for i, (b, a) in enumerate(zip(before, after_rerank)):
    pct = (a - b) / b * 100
    ax.annotate(f'+{pct:.1f}%', xy=(x[i] + width + 0.05, a + 0.02),
                fontsize=10, color=COLORS["best"], fontweight="bold")

ax.set_xticks(x)
ax.set_xticklabels(categories, fontsize=12)
ax.set_ylim(0.55, 1.05)
ax.legend(loc="upper left", fontsize=10, framealpha=0.3)
fig.tight_layout()
fig.savefig(OUT_DIR / "sweep_5_final_comparison.png", dpi=150)
plt.close()

# =========================================================================
# Chart 6: All experiments timeline
# =========================================================================
fig, ax = plt.subplots(figsize=(14, 6))
fig.patch.set_facecolor("#0F0F1A")

all_experiments = [
    "cand=4x", "cand=6x", "cand=8x", "cand=10x", "cand=12x", "cand=16x", "cand=20x",
    "rerank\nn=5", "rerank\nn=10", "rerank\nn=15", "rerank\nn=20", "rerank\nn=25", "rerank\nn=30", "rerank\nn=40",
    "mmr\n1.0", "mmr\n0.95", "mmr\n0.9", "mmr\n0.85", "mmr\n0.8", "mmr\n0.75", "mmr\n0.7", "mmr\n0.6", "mmr\n0.5",
    "cap\n0", "cap\n1", "cap\n2", "cap\n3", "cap\n4",
]
all_ndcg = [
    0.7669, 0.7702, 0.7713, 0.7713, 0.7713, 0.7713, 0.7713,
    0.7627, 0.7553, 0.7902, 0.7936, 0.7937, 0.8000, 0.7866,
    0.7901, 0.7761, 0.7721, 0.7756, 0.7673, 0.7772, 0.7839, 0.7879, 0.7699,
    0.7817, 0.7870, 0.7905, 0.7813, 0.7912,
]

setup_ax(ax, "Full Experiment Timeline — NDCG@5 Across All Configurations", "Experiment", "NDCG@5")
colors_list = (
    [COLORS["ndcg5"]] * 7 +
    [COLORS["mrr"]] * 7 +
    [COLORS["hit3"]] * 9 +
    ["#E066FF"] * 5
)
bars = ax.bar(range(len(all_experiments)), all_ndcg, color=colors_list, alpha=0.8)

# Phase separators
for sep in [7, 14, 23]:
    ax.axvline(x=sep - 0.5, color="#444444", linestyle=":", alpha=0.5)

# Phase labels
ax.text(3, 0.82, "Phase 1\nCandidate Pool", ha="center", fontsize=8, color="#888888")
ax.text(10.5, 0.82, "Phase 2\nRerank Top-N", ha="center", fontsize=8, color="#888888")
ax.text(18.5, 0.82, "Phase 3\nMMR Lambda", ha="center", fontsize=8, color="#888888")
ax.text(25.5, 0.82, "Phase 4\nCap/Video", ha="center", fontsize=8, color="#888888")

# Best line
best_idx = all_ndcg.index(max(all_ndcg))
ax.axhline(y=max(all_ndcg), color=COLORS["best"], linestyle="--", alpha=0.4)
ax.annotate(f"Best: {max(all_ndcg):.4f}", xy=(best_idx, max(all_ndcg) + 0.003),
            fontsize=10, color=COLORS["best"], fontweight="bold", ha="center")

ax.set_xticks(range(len(all_experiments)))
ax.set_xticklabels(all_experiments, fontsize=7, rotation=0)
ax.set_ylim(0.74, 0.83)
fig.tight_layout()
fig.savefig(OUT_DIR / "sweep_6_timeline.png", dpi=150)
plt.close()

print("Generated 6 charts in eval/:")
for f in sorted(OUT_DIR.glob("sweep_*.png")):
    print(f"  {f.name}")
