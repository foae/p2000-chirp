import { expect, test } from "bun:test";
import type { P2000Item } from "../feed";
import {
  extractPostcodes,
  inferDiscipline,
  matchesArea,
  matchesDiscipline,
  normalizeMessage,
  trailingSequence,
} from "../filter";

const item = (over: Partial<P2000Item>): P2000Item => ({
  source: "rss",
  capcode: "",
  message: "",
  regName: "",
  dienst: "",
  lat: null,
  lon: null,
  pubDate: new Date(0),
  ...over,
});

test("dienst/class metadata wins over message prefixes", () => {
  expect(inferDiscipline(item({ dienst: "Brandweerdiensten", message: "P 1 BNH-01 BR woning" }))).toBe("Brandweer");
  expect(inferDiscipline(item({ dienst: "Politiediensten", message: "Aanrijding letsel" }))).toBe("Politie");
  expect(inferDiscipline(item({ dienst: "Ambulance", message: "P 2 BDH-02 BR container" }))).toBe("Ambulance");
});

test("prefix fallbacks: A and B are ambulance priorities, P is brandweer priority", () => {
  expect(inferDiscipline(item({ message: "A1 13174 Achter de Dom Utrecht" }))).toBe("Ambulance");
  expect(inferDiscipline(item({ message: "B2 AMBU 17205 Kleiweg" }))).toBe("Ambulance");
  expect(inferDiscipline(item({ message: "P 2 BDH-02 Dier in problemen" }))).toBe("Brandweer");
});

test("Gereserveerd copies fall back to the message prefix", () => {
  expect(inferDiscipline(item({ dienst: "Gereserveerd", message: "A2 13122 Oosterkade Utrecht" }))).toBe("Ambulance");
  expect(inferDiscipline(item({ dienst: "Gereserveerd", message: "P 2 BOB-01 Brandgerucht Erp" }))).toBe("Brandweer");
});

test("'Prio' is not a discipline prefix", () => {
  expect(inferDiscipline(item({ dienst: "Politie", message: "Prio 1 Scheveningseweg" }))).toBe("Politie");
  expect(inferDiscipline(item({ message: "Prio 1 Scheveningseweg" }))).toBe("Onbekend");
});

test("prefixless, dienstless items are Onbekend and fail a discipline filter", () => {
  const unknown = item({ message: "TESTOPROEP MOB" });
  expect(inferDiscipline(unknown)).toBe("Onbekend");
  expect(matchesDiscipline(unknown, ["Brandweer", "Ambulance", "Politie"])).toBe(false);
  expect(matchesDiscipline(unknown, [])).toBe(true);
});

test("postcode extraction", () => {
  expect(extractPostcodes("AMBU 17152 dr. Wiardi Beckmansingel 3132CX Vlaardingen")).toEqual(["3132"]);
  expect(extractPostcodes("Parallelweg 3371 GA Hardinxveld")).toEqual(["3371"]);
  expect(extractPostcodes("Kleiweg 3045PM Rotterdam")).toEqual(["3045"]);
  expect(extractPostcodes("1234567AB somewhere")).toEqual([]);
  expect(extractPostcodes("geen postcode hier")).toEqual([]);
});

test("trailing sequence extraction (5+ digits only)", () => {
  expect(trailingSequence("B2 AMBU 17205 Kleiweg 3045PM Rotterdam ROTTDM bon 138437")).toBe("138437");
  expect(trailingSequence("A2 Eindhoven Rit: 106481")).toBe("106481");
  expect(trailingSequence("A1 Crocusstraat KATWZH : 16190")).toBe("16190");
  expect(trailingSequence("Einde vws")).toBeUndefined();
  expect(trailingSequence("some 1234")).toBeUndefined();
});

test("normalizeMessage collapses whitespace", () => {
  expect(normalizeMessage("  A2   Woerden\t 146159 ")).toBe("A2 Woerden 146159");
});

const noFilters = { regions: [], postcodes: [], keywords: [], disciplines: [], radius: null };
const dom = { lat: 52.0907, lon: 5.1214, km: 1.5 };

test("area axes OR together; empty lists pass everything", () => {
  expect(matchesArea(item({ message: "anything" }), noFilters)).toBe(true);
  expect(matchesArea(item({ message: "Kleiweg 3045PM", regName: "Rotterdam" }), { ...noFilters, postcodes: ["304"] })).toBe(true);
  expect(matchesArea(item({ message: "Kleiweg", regName: "Rotterdam Rijnmond" }), { ...noFilters, regions: ["Rotterdam-Rijnmond"] })).toBe(true);
  expect(matchesArea(item({ message: "Oudegracht" }), { ...noFilters, keywords: ["oudegracht"] })).toBe(true);
});

test("no configured axis matching means filtered out", () => {
  const filters = { ...noFilters, postcodes: ["3511"], keywords: ["Oudegracht"], regions: ["Utrecht"], radius: dom };
  expect(matchesArea(item({ message: "Kleiweg 3045PM Rotterdam", regName: "Rotterdam Rijnmond" }), filters)).toBe(false);
});

test("radius matches coordinates inside, not outside; missing coords fall through", () => {
  const filters = { ...noFilters, radius: dom };
  expect(matchesArea(item({ message: "x", lat: 52.091, lon: 5.121 }), filters)).toBe(true);
  expect(matchesArea(item({ message: "x", lat: 52.35, lon: 4.9 }), filters)).toBe(false);
  expect(matchesArea(item({ message: "x" }), filters)).toBe(false);
});

test("discipline short forms match via prefix", () => {
  const ambulance = item({ dienst: "Ambulancediensten", message: "A1 test" });
  expect(matchesDiscipline(ambulance, ["Ambu"])).toBe(true);
  expect(matchesDiscipline(ambulance, ["Politie"])).toBe(false);
});
