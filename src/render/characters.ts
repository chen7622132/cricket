export type CharacterId = "martial" | "samurai" | "huntress" | "wizard";

export interface CharacterDef {
  id: CharacterId;
  name: string;
  style: string;
  sheetUrl: string;
  projectile: "arrow" | "orb" | "knife" | "wave";
  element: "fire" | "thunder" | "ice";
}

/** 四名可选角色，素材均来自 LuizMelo（CC0），构建产物同名 json。 */
export const CHARACTERS: CharacterDef[] = [
  { id: "martial", name: "武僧", style: "拳脚/短兵", sheetUrl: "assets/martial-hero/hero.json", projectile: "wave", element: "thunder" },
  { id: "samurai", name: "武士", style: "太刀连斩", sheetUrl: "assets/samurai-mack/enemy.json", projectile: "knife", element: "fire" },
  { id: "huntress", name: "猎手", style: "长弓/突进", sheetUrl: "assets/huntress/huntress.json", projectile: "arrow", element: "ice" },
  { id: "wizard", name: "法师", style: "法杖/远程", sheetUrl: "assets/evil-wizard/wizard.json", projectile: "orb", element: "fire" },
];

export const CHARACTER_IDS: CharacterId[] = CHARACTERS.map((c) => c.id);

export function characterOf(id: string | null | undefined): CharacterDef {
  return CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];
}



