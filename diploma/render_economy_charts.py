#!/usr/bin/env python
"""Генерує графіки для розділу 5 (економіка)."""
import os

import matplotlib.pyplot as plt

HERE = os.path.dirname(os.path.abspath(__file__))
FIG = os.path.join(HERE, "figures")
os.makedirs(FIG, exist_ok=True)

plt.rcParams["font.family"] = "DejaVu Sans"
plt.rcParams["axes.unicode_minus"] = False


def chart_dev_cost():
    labels = [
        "Аналіз і\nпроєктування",
        "Ядро",
        "Сервер і UI",
        "Платформа\nі оплата",
        "Тестування\nі CI",
        "Документація",
    ]
    sizes = [24000, 32000, 40000, 24000, 20000, 20000]
    colors = ["#4C6EF5", "#7950F2", "#BE4BDB", "#E64980", "#FD7E14", "#12B886"]
    fig, ax = plt.subplots(figsize=(8, 5.2), dpi=160)
    wedges, texts, autotexts = ax.pie(
        sizes,
        labels=labels,
        autopct=lambda p: f"{p:.0f}%",
        startangle=90,
        colors=colors,
        textprops={"fontsize": 9},
    )
    for t in autotexts:
        t.set_color("white")
        t.set_fontsize(9)
        t.set_fontweight("bold")
    ax.set_title("Структура вартості розробки (160 000 грн)", fontsize=12, pad=12)
    fig.tight_layout()
    out = os.path.join(FIG, "rys-5-1.png")
    fig.savefig(out, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    print("OK", out)


def chart_opex_breakeven():
    fig, axes = plt.subplots(1, 2, figsize=(10, 4.2), dpi=160)

    ax0 = axes[0]
    items = ["VPS", "Домен/DNS", "Копія Hetzner"]
    vals = [3960, 580, 3960]
    bars = ax0.bar(items, vals, color=["#4C6EF5", "#12B886", "#FD7E14"])
    ax0.set_ylabel("грн / рік")
    ax0.set_title("Постійні витрати інфраструктури")
    for b, v in zip(bars, vals):
        ax0.text(b.get_x() + b.get_width() / 2, v + 40, str(v), ha="center", fontsize=9)
    ax0.set_ylim(0, 4800)

    ax1 = axes[1]
    packs = ["Старт\n(4,99$)", "Креатор\n(14,99$)", "Профі\n(29,99$)"]
    need = [15, 5, 3]  # approx packs/month to cover ~708 грн/міс (8 500 грн/рік)
    bars1 = ax1.bar(packs, need, color=["#7950F2", "#BE4BDB", "#E64980"])
    ax1.set_ylabel("пакетів / місяць")
    ax1.set_title("Орієнтовна точка беззбитковості")
    for b, v in zip(bars1, need):
        ax1.text(b.get_x() + b.get_width() / 2, v + 0.15, str(v), ha="center", fontsize=10)
    ax1.set_ylim(0, 17)

    fig.suptitle("Експлуатаційні витрати та окупність сервісу", fontsize=12)
    fig.tight_layout()
    out = os.path.join(FIG, "rys-5-2.png")
    fig.savefig(out, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    print("OK", out)


if __name__ == "__main__":
    chart_dev_cost()
    chart_opex_breakeven()
