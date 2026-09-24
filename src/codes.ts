import type { Discipline } from "./filter";

export interface DispatchCode {
  code: string;
  meaning: string;
  description: string;
  pattern: RegExp;
}

export const AMBULANCE_CODES: readonly DispatchCode[] = [
  { code: "A0", meaning: "highest-urgency", description: "Hoogste spoed: directe inzet met de grootst mogelijke urgentie", pattern: /^\s*A\s?0(?![\p{L}\p{M}\p{N}_])/iu },
  { code: "A1", meaning: "emergency", description: "Spoed: mogelijk bedreigde vitale functies", pattern: /^\s*A\s?1(?![\p{L}\p{M}\p{N}_])/iu },
  { code: "A2", meaning: "urgent", description: "Urgent: geen direct levensgevaar vastgesteld", pattern: /^\s*A\s?2(?![\p{L}\p{M}\p{N}_])/iu },
  { code: "B1", meaning: "high-complexity-transport", description: "Niet-spoedeisend vervoer met hoogcomplexe zorg", pattern: /^\s*B\s?1(?![\p{L}\p{M}\p{N}_])/iu },
  { code: "B2", meaning: "medium-low-complexity-transport", description: "Niet-spoedeisend vervoer met midden- of laagcomplexe zorg", pattern: /^\s*B\s?2(?![\p{L}\p{M}\p{N}_])/iu },
  { code: "DIA", meaning: "direct-dispatch", description: "Directe Inzet Ambulance: al onderweg tijdens het uitvragen van de melder", pattern: /(?<![\p{L}\p{M}\p{N}_])(?:DIA|directe\s+inzet\s*:\s*ja)(?![\p{L}\p{M}\p{N}_])/iu },
  { code: "VWS", meaning: "coverage-relocation", description: "Voorwaardenscheppend: ambulancebeschikbaarheid in het gebied", pattern: /(?<![\p{L}\p{M}\p{N}_])VWS(?![\p{L}\p{M}\p{N}_])/iu },
];

const CRISIS_COORDINATION: DispatchCode = {
  code: "GRIP",
  meaning: "crisis-coordination",
  description: "Gecoördineerde Regionale Incidentbestrijdingsprocedure: gezamenlijke crisiscoördinatie",
  pattern: /(?<![\p{L}\p{M}\p{N}_])GRIP(?:\s*\d+)?(?![\p{L}\p{M}\p{N}_])/iu,
};

export const FIRE_CODES: readonly DispatchCode[] = [
  { code: "P1", meaning: "emergency", description: "Spoed: zo snel mogelijk ter plaatse voor een dringende taak", pattern: /^\s*(?:P|Prio)\s*1(?![\p{L}\p{M}\p{N}_])/iu },
  { code: "P2", meaning: "prompt-response", description: "Snel ter plaatse, zonder direct dringende taak", pattern: /^\s*(?:P|Prio)\s*2(?![\p{L}\p{M}\p{N}_])/iu },
  { code: "OMS", meaning: "automatic-fire-alarm", description: "Openbaar Meldsysteem: automatische brandmelding, geen bevestiging van brand", pattern: /(?<![\p{L}\p{M}\p{N}_])OMS(?![\p{L}\p{M}\p{N}_])/iu },
  { code: "TS", meaning: "fire-engine", description: "Tankautospuit", pattern: /(?<![\p{L}\p{M}\p{N}_])TS(?![\p{L}\p{M}\p{N}_])/iu },
  { code: "HW", meaning: "aerial-platform", description: "Hoogwerker", pattern: /(?<![\p{L}\p{M}\p{N}_])HW(?![\p{L}\p{M}\p{N}_])/iu },
  { code: "AL", meaning: "aerial-ladder", description: "Autoladder", pattern: /(?:\(\s*AL\s*\)|(?<![\p{L}\p{M}\p{N}_])AL(?=\s+\d{6}(?![\p{L}\p{M}\p{N}_])))/iu },
  { code: "HV", meaning: "rescue-vehicle", description: "Hulpverleningsvoertuig", pattern: /(?:\(\s*HV\s*\)|(?<![\p{L}\p{M}\p{N}_])HV(?=\s+\d{6}(?![\p{L}\p{M}\p{N}_])))/iu },
  { code: "WO", meaning: "water-incident-or-unit", description: "Waterongeval of waterongevallenvoertuig (contextafhankelijk)", pattern: /(?<![\p{L}\p{M}\p{N}_])WO(?![\p{L}\p{M}\p{N}_])/iu },
  { code: "OVD", meaning: "duty-officer", description: "Officier van Dienst (brandweer)", pattern: /(?<![\p{L}\p{M}\p{N}_-])OVD(?:-B)?(?![\p{L}\p{M}\p{N}_-])/iu },
  CRISIS_COORDINATION,
];

export const POLICE_CODES: readonly DispatchCode[] = [
  { code: "PRIO1", meaning: "highest-urgency", description: "Hoogste spoed volgens de politiemeldkamer; geen uitspraak over sirenegebruik", pattern: /^\s*Prio\s*1(?![\p{L}\p{M}\p{N}_])/iu },
  { code: "OVD-P", meaning: "duty-officer", description: "Officier van Dienst Politie: operationele leiding op locatie", pattern: /(?<![\p{L}\p{M}\p{N}_-])OVD-?P(?![\p{L}\p{M}\p{N}_-])/iu },
  { code: "FO", meaning: "forensic-investigation", description: "Forensische Opsporing (FO-Verkeer: verkeersonderzoek)", pattern: /(?<![\p{L}\p{M}\p{N}_])FO(?:-Verkeer)?(?![\p{L}\p{M}\p{N}_-])/iu },
  CRISIS_COORDINATION,
];

export const CODE_CATALOGS: Record<Discipline, readonly DispatchCode[]> = {
  Ambulance: AMBULANCE_CODES,
  Brandweer: FIRE_CODES,
  Politie: POLICE_CODES,
  KNRM: [],
  Onbekend: [],
};

export function parseCodeSelection(values: string[], catalog: readonly DispatchCode[], key: string): string[] {
  return [...new Set(values.map((value) => {
    const normalized = value.trim().toLowerCase();
    const entry = catalog.find((entry) => entry.code.toLowerCase() === normalized || entry.meaning === normalized);
    if (!entry) {
      throw new Error(`filters.${key} has unknown code or meaning "${value}" (expected ${catalog.map((entry) => `${entry.code}/${entry.meaning}`).join(", ")})`);
    }
    return entry.code;
  }))];
}

export function explainDispatch(message: string, discipline: Discipline): string[] {
  const explanations = CODE_CATALOGS[discipline].filter((entry) => entry.pattern.test(message))
    .map((entry) => `${entry.code} — ${entry.description}`);
  if (discipline !== "Ambulance") return explanations;
  const unit = message.match(/^\s*(?:A\s?[012]|B\s?[12])\s+(?:\((?:DIA|VWS)\)\s+)?(?:AMBU\s+)?(\d{2})(\d{3})(?=\s|$)/i);
  if (unit) explanations.push(`Ambulance-eenheid: ${unit[1]}-${unit[2]} (roepnummer)`);
  for (const reference of message.matchAll(/(?<![\p{L}\p{M}\p{N}_])(bon|rit)\s*:?\s*(\d+)(?![\p{L}\p{M}\p{N}_])/giu)) {
    explanations.push(`${reference[1].toLowerCase() === "bon" ? "Bonnummer" : "Ritnummer"}: ${reference[2]} (ritreferentie)`);
  }
  return explanations;
}
