/* ── Russian content (V3) ────────────────────────────────────────────
   Parallel to content.js. Same keys, same shape, Russian prose.

   HOW TO FILL THIS IN
   - Translate the text between the backticks. Leave the KEYS alone:
     `taurus`, `newMoonAffirmations`, the house numbers — those are
     codes the app matches on, not words anyone reads.
   - An empty string means "not translated yet" and falls back to the
     English for that one entry (see mergeOver in i18n.js). So this file
     can ship half-finished without showing an empty panel to anyone.
   - Keep the formatting marks: a line starting with ◗ becomes a gold
     label, the first line becomes the sub-heading, "1." numbering becomes
     a numbered step. Translate the words after ◗, keep the ◗.
   - Keep the paragraph breaks. Blank lines separate paragraphs.

   The English source is content.js; the key lists below are generated
   from it, so every entry that exists in English has a slot here. */

export const CONTENT = {

  /* Daily reading, by Moon sign — 12 entries */
  dailyMoonInSign: {
    aries: ``,   // EN: 6 line(s)
    taurus: ``,   // EN: 11 line(s)
    gemini: ``,   // EN: 7 line(s)
    cancer: ``,   // EN: 10 line(s)
    leo: ``,   // EN: 11 line(s)
    virgo: ``,   // EN: 7 line(s)
    libra: ``,   // EN: 7 line(s)
    scorpio: ``,   // EN: 7 line(s)
    sagittarius: ``,   // EN: 7 line(s)
    capricorn: ``,   // EN: 7 line(s)
    aquarius: ``,   // EN: 7 line(s)
    pisces: ``,   // EN: 7 line(s)
  },

  /* Daily reading, by natal house — 12 entries, keyed 1-12 */
  dailyMoonInHouse: {
    "1": ``,   // EN: 3 line(s)
    "2": ``,   // EN: 3 line(s)
    "3": ``,   // EN: 3 line(s)
    "4": ``,   // EN: 3 line(s)
    "5": ``,   // EN: 3 line(s)
    "6": ``,   // EN: 3 line(s)
    "7": ``,   // EN: 3 line(s)
    "8": ``,   // EN: 3 line(s)
    "9": ``,   // EN: 3 line(s)
    "10": ``,   // EN: 3 line(s)
    "11": ``,   // EN: 3 line(s)
    "12": ``,   // EN: 3 line(s)
  },

  /* New Moon, by sign */
  newMoonInSign: {
    aries: ``,   // EN: 11 line(s)
    taurus: ``,   // EN: 13 line(s)
    gemini: ``,   // EN: 11 line(s)
    cancer: ``,   // EN: 12 line(s)
    leo: ``,   // EN: 11 line(s)
    virgo: ``,   // EN: 11 line(s)
    libra: ``,   // EN: 11 line(s)
    scorpio: ``,   // EN: 11 line(s)
    sagittarius: ``,   // EN: 11 line(s)
    capricorn: ``,   // EN: 10 line(s)
    aquarius: ``,   // EN: 11 line(s)
    pisces: ``,   // EN: 11 line(s)
  },

  /* New Moon, by natal house */
  newMoonInHouse: {
    "1": ``,   // EN: 31 line(s)
    "2": ``,   // EN: 32 line(s)
    "3": ``,   // EN: 30 line(s)
    "4": ``,   // EN: 32 line(s)
    "5": ``,   // EN: 33 line(s)
    "6": ``,   // EN: 34 line(s)
    "7": ``,   // EN: 28 line(s)
    "8": ``,   // EN: 24 line(s)
    "9": ``,   // EN: 31 line(s)
    "10": ``,   // EN: 32 line(s)
    "11": ``,   // EN: 30 line(s)
    "12": ``,   // EN: 32 line(s)
  },

  /* Full Moon, by sign */
  fullMoonInSign: {
    aries: ``,   // EN: 18 line(s)
    taurus: ``,   // EN: 18 line(s)
    gemini: ``,   // EN: 18 line(s)
    cancer: ``,   // EN: 18 line(s)
    leo: ``,   // EN: 18 line(s)
    virgo: ``,   // EN: 19 line(s)
    libra: ``,   // EN: 19 line(s)
    scorpio: ``,   // EN: 25 line(s)
    sagittarius: ``,   // EN: 21 line(s)
    capricorn: ``,   // EN: 18 line(s)
    aquarius: ``,   // EN: 18 line(s)
    pisces: ``,   // EN: 18 line(s)
  },

  /* Full Moon, by natal house */
  fullMoonInHouse: {
    "1": ``,   // EN: 21 line(s)
    "2": ``,   // EN: 20 line(s)
    "3": ``,   // EN: 20 line(s)
    "4": ``,   // EN: 21 line(s)
    "5": ``,   // EN: 21 line(s)
    "6": ``,   // EN: 21 line(s)
    "7": ``,   // EN: 20 line(s)
    "8": ``,   // EN: 21 line(s)
    "9": ``,   // EN: 22 line(s)
    "10": ``,   // EN: 20 line(s)
    "11": ``,   // EN: 23 line(s)
    "12": ``,   // EN: 22 line(s)
  },

  /* First Quarter, by sign */
  firstQuarterInSign: {
    aries: ``,   // EN: 1 line(s)
    taurus: ``,   // EN: 1 line(s)
    gemini: ``,   // EN: 1 line(s)
    cancer: ``,   // EN: 1 line(s)
    leo: ``,   // EN: 1 line(s)
    virgo: ``,   // EN: 1 line(s)
    libra: ``,   // EN: 1 line(s)
    scorpio: ``,   // EN: 1 line(s)
    sagittarius: ``,   // EN: 1 line(s)
    capricorn: ``,   // EN: 1 line(s)
    aquarius: ``,   // EN: 1 line(s)
    pisces: ``,   // EN: 1 line(s)
  },

  /* Last Quarter, by sign */
  lastQuarterInSign: {
    aries: ``,   // EN: 1 line(s)
    taurus: ``,   // EN: 1 line(s)
    gemini: ``,   // EN: 1 line(s)
    cancer: ``,   // EN: 1 line(s)
    leo: ``,   // EN: 1 line(s)
    virgo: ``,   // EN: 1 line(s)
    libra: ``,   // EN: 1 line(s)
    scorpio: ``,   // EN: 1 line(s)
    sagittarius: ``,   // EN: 1 line(s)
    capricorn: ``,   // EN: 1 line(s)
    aquarius: ``,   // EN: 1 line(s)
    pisces: ``,   // EN: 1 line(s)
  },

  /* Affirmations, by natal house. Keep the count per house. */
  newMoonAffirmations: {
    "1": ["", "", ""],   // 3 affirmation(s) in English
    "2": ["", "", ""],   // 3 affirmation(s) in English
    "3": ["", "", ""],   // 3 affirmation(s) in English
    "4": ["", "", ""],   // 3 affirmation(s) in English
    "5": ["", "", ""],   // 3 affirmation(s) in English
    "6": ["", "", ""],   // 3 affirmation(s) in English
    "7": ["", "", ""],   // 3 affirmation(s) in English
    "8": ["", "", ""],   // 3 affirmation(s) in English
    "9": ["", "", ""],   // 3 affirmation(s) in English
    "10": ["", "", ""],   // 3 affirmation(s) in English
    "11": ["", "", ""],   // 3 affirmation(s) in English
    "12": ["", "", ""],   // 3 affirmation(s) in English
  },

  /* New Moon ritual. `heading` shows as a gold label; `text` is the body.
     Keep the number of parts and their order — the app pairs them with
     the ritual-completion toggles by position. */
  newMoonRitual: {
    title: ``,   // EN: New Moon Wishing Ritual
    parts: [
      { heading: ``,   // EN: (no heading)
        text: `` },   // EN: 12 line(s)
      { heading: ``,   // EN: Do’s and Don’ts of New Moon Wishing:
        text: `` },   // EN: 8 line(s)
    ],
  },

  /* Full Moon ritual. `heading` shows as a gold label; `text` is the body.
     Keep the number of parts and their order — the app pairs them with
     the ritual-completion toggles by position. */
  fullMoonRitual: {
    title: ``,   // EN: Full Moon Rituals
    parts: [
      { heading: ``,   // EN: Full Moon Forgiveness Ceremony
        text: `` },   // EN: 12 line(s)
      { heading: ``,   // EN: Entering a State of Gratitude
        text: `` },   // EN: 6 line(s)
    ],
  },
};

