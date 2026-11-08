import { describe, expect, it } from "vitest";
import { getRuleset } from "../src/engine/rules.ts";

describe("规则表数量", () => {
  it("英雄与敌方各 5 套，且都有可执行规则", () => {
    const heroes = ["A", "B", "C", "D", "E"] as const;
    const enemies = ["ENEMY", "ENEMY_B", "ENEMY_C", "ENEMY_D", "ENEMY_E"] as const;
    for (const id of heroes) {
      const rs = getRuleset(id);
      expect(rs.side).toBe("hero");
      expect(rs.rules.length).toBeGreaterThan(0);
      expect(rs.name.length).toBeGreaterThan(0);
    }
    for (const id of enemies) {
      const rs = getRuleset(id);
      expect(rs.side).toBe("enemy");
      expect(rs.rules.length).toBeGreaterThan(0);
    }
    const heroNames = new Set(heroes.map((id) => getRuleset(id).name));
    const enemyNames = new Set(enemies.map((id) => getRuleset(id).name));
    expect(heroNames.size).toBe(5);
    expect(enemyNames.size).toBe(5);
  });

  it("每套规则 id 唯一、序号连续", () => {
    for (const id of ["A", "B", "C", "D", "E", "ENEMY", "ENEMY_B", "ENEMY_C", "ENEMY_D", "ENEMY_E"] as const) {
      const rs = getRuleset(id);
      const ids = rs.rules.map((r) => r.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(rs.rules.map((r) => r.index)).toEqual(rs.rules.map((_, i) => i + 1));
    }
  });
});
