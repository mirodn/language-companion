import mymemory from "./mymemory.js";
import deepl from "./deepl.js";
import libretranslate from "./libretranslate.js";
import freedictionary from "./freedictionary.js";
import wiktionary from "./wiktionary.js";
import jisho from "./jisho.js";
import cedict from "./cedict.js";
import kanjidic from "./kanjidic.js";
import tatoeba from "./tatoeba.js";

export const translators = [mymemory, deepl, libretranslate];

// Order matters: earlier dictionaries win for IPA, audio and definitions.
export const dictionaries = [freedictionary, jisho, cedict, kanjidic, wiktionary];
export const exampleSources = [tatoeba];

export const allProviders = [...translators, ...dictionaries, ...exampleSources];
