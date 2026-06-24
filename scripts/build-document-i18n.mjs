import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const labels = {
  ar: ["الفصل", "المراجع", "الشكل", "الجدول", "الملخص", "المحتويات", "الملحق", "المسرد", "الاختصارات", "الكلمات المفتاحية", "يتبع", "المصدر"],
  cs: ["Kapitola", "Literatura", "Obrázek", "Tabulka", "Abstrakt", "Obsah", "Příloha", "Slovník", "Zkratky", "Klíčová slova", "pokračování", "Zdroj"],
  de: ["Kapitel", "Literaturverzeichnis", "Abbildung", "Tabelle", "Zusammenfassung", "Inhaltsverzeichnis", "Anhang", "Glossar", "Abkürzungen", "Schlüsselwörter", "Fortsetzung", "Quelle"],
  fa: ["فصل", "منابع", "شکل", "جدول", "چکیده", "فهرست مطالب", "پیوست", "واژه‌نامه", "اختصارات", "کلیدواژه‌ها", "ادامه", "منبع"],
  fil: ["Kabanata", "Mga Sanggunian", "Larawan", "Talahanayan", "Abstrak", "Talaan ng Nilalaman", "Apendise", "Talasalitaan", "Mga Daglat", "Mga Susing Salita", "ipinagpatuloy", "Pinagmulan"],
  fr: ["Chapitre", "Bibliographie", "Figure", "Tableau", "Résumé", "Table des matières", "Annexe", "Glossaire", "Abréviations", "Mots-clés", "suite", "Source"],
  he: ["פרק", "ביבליוגרפיה", "איור", "טבלה", "תקציר", "תוכן עניינים", "נספח", "מילון מונחים", "קיצורים", "מילות מפתח", "המשך", "מקור"],
  hi: ["अध्याय", "संदर्भ", "चित्र", "तालिका", "सारांश", "विषय-सूची", "परिशिष्ट", "शब्दावली", "संक्षिप्ताक्षर", "मुख्य शब्द", "जारी", "स्रोत"],
  it: ["Capitolo", "Bibliografia", "Figura", "Tabella", "Sommario", "Indice", "Appendice", "Glossario", "Abbreviazioni", "Parole chiave", "continua", "Fonte"],
  ja: ["章", "参考文献", "図", "表", "要旨", "目次", "付録", "用語集", "略語", "キーワード", "続き", "出典"],
  ko: ["장", "참고문헌", "그림", "표", "초록", "목차", "부록", "용어집", "약어", "핵심어", "계속", "출처"],
  mix: ["Capítulo", "Referencias", "Figura", "Tabla", "Resumen", "Índice", "Anexo", "Glosario", "Abreviaturas", "Palabras clave", "continuación", "Fuente"],
  nah: ["Centlamantli", "Tlahtolnextilihtzin", "Tlaixnextiloni", "Tlahcuilōamaitl", "Ioltenehualiztli", "Tlapohualamaitl", "Anexo", "Glosario", "Abreviaturas", "Palabras clave", "continuación", "Fuente"],
  nl: ["Hoofdstuk", "Bibliografie", "Figuur", "Tabel", "Samenvatting", "Inhoudsopgave", "Bijlage", "Woordenlijst", "Afkortingen", "Trefwoorden", "vervolg", "Bron"],
  pl: ["Rozdział", "Bibliografia", "Rysunek", "Tabela", "Streszczenie", "Spis treści", "Dodatek", "Słownik", "Skróty", "Słowa kluczowe", "ciąg dalszy", "Źródło"],
  "pt-BR": ["Capítulo", "Referências", "Figura", "Tabela", "Resumo", "Sumário", "Apêndice", "Glossário", "Abreviaturas", "Palavras-chave", "continuação", "Fonte"],
  ro: ["Capitol", "Bibliografie", "Figură", "Tabel", "Rezumat", "Cuprins", "Anexă", "Glosar", "Abrevieri", "Cuvinte-cheie", "continuare", "Sursă"],
  ru: ["Глава", "Список литературы", "Рисунок", "Таблица", "Аннотация", "Содержание", "Приложение", "Глоссарий", "Сокращения", "Ключевые слова", "продолжение", "Источник"],
  sv: ["Kapitel", "Referenser", "Figur", "Tabell", "Sammanfattning", "Innehållsförteckning", "Bilaga", "Ordlista", "Förkortningar", "Nyckelord", "fortsättning", "Källa"],
  th: ["บท", "บรรณานุกรม", "รูป", "ตาราง", "บทคัดย่อ", "สารบัญ", "ภาคผนวก", "อภิธานศัพท์", "คำย่อ", "คำสำคัญ", "ต่อ", "ที่มา"],
  tr: ["Bölüm", "Kaynakça", "Şekil", "Tablo", "Özet", "İçindekiler", "Ek", "Sözlük", "Kısaltmalar", "Anahtar kelimeler", "devam", "Kaynak"],
  tzh: ["Capítulo", "Referencias", "Figura", "Tabla", "Resumen", "Índice", "Anexo", "Glosario", "Abreviaturas", "Palabras clave", "continuación", "Fuente"],
  uk: ["Розділ", "Список літератури", "Рисунок", "Таблиця", "Анотація", "Зміст", "Додаток", "Глосарій", "Скорочення", "Ключові слова", "продовження", "Джерело"],
  vi: ["Chương", "Tài liệu tham khảo", "Hình", "Bảng", "Tóm tắt", "Mục lục", "Phụ lục", "Thuật ngữ", "Chữ viết tắt", "Từ khóa", "tiếp theo", "Nguồn"],
  yua: ["Capítulo", "Referencias", "Figura", "Tabla", "Resumen", "Índice", "Anexo", "Glosario", "Abreviaturas", "Palabras clave", "continuación", "Fuente"],
  zap: ["Capítulo", "Referencias", "Figura", "Tabla", "Resumen", "Índice", "Anexo", "Glosario", "Abreviaturas", "Palabras clave", "continuación", "Fuente"],
  zh: ["章", "参考文献", "图", "表", "摘要", "目录", "附录", "术语表", "缩略语", "关键词", "续", "来源"],
};

const keys = [
  "chapter",
  "bibliography",
  "figure",
  "table",
  "abstract",
  "contents",
  "appendix",
  "glossary",
  "acronyms",
  "keywords",
  "continued",
  "source",
];
const spanishFallback = new Set(["mix", "nah", "tzh", "yua", "zap"]);

for (const [locale, values] of Object.entries(labels)) {
  const document = Object.fromEntries(keys.map((key, index) => [key, values[index]]));
  const payload = {
    schema_version: "2.0",
    locale,
    fallback_locale: spanishFallback.has(locale) ? "es" : null,
    labels: document,
  };
  const directory = path.join(root, "packs", locale);
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "document.json"),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
}

console.log(`Generated ${Object.keys(labels).length} document locale resources.`);
