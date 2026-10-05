/**
 * Tiered moderation lexicon — TypeScript port of backend/app/moderation/lexicon.py.
 *
 * Design note (carried over verbatim from the Python source)
 * -----------------------------------------------------------
 * This is a *recovery* community, so the obvious approach -- block words like
 * "relapse", "porn" or "struggling" -- would be actively harmful. People need
 * to be able to name their addiction and ask for help in public.
 *
 * So the lexicon separates three things:
 *
 * BLOCK   explicit sexual content, solicitation/trading, encouragement or
 *         glorification of the behaviour, gambling promotion, self-harm
 *         instructions, and slurs/harassment aimed at another member.
 * FLAG    ambiguous risk: unvetted outbound links, money talk, self-directed
 *         hostility. Allowed through, logged, visible to admins.
 * ALLOW   recovery vocabulary. Explicitly never scored, so the engine can
 *         never penalise someone for asking for help.
 *
 * When in doubt this file errs toward ALLOW; the Python second-opinion layer
 * (consulted by engine.ts for non-allow local verdicts) is what catches novel
 * slang.
 *
 * The TS list is the superset: it runs first with zero network latency, so it
 * carries extra terms the Python list does not. The Python service is still
 * consulted as a second opinion, but only its non-allow verdicts are adopted
 * (see moderateChatContent in engine.ts) — so a term present only here can
 * never be talked out of a block by the smaller remote lexicon.
 */

export type Term = {
  pattern: string;
  category: string;
  severity: "block" | "flag";
};

const block = (pattern: string, category: string): Term => ({
  pattern,
  category,
  severity: "block",
});

const flag = (pattern: string, category: string): Term => ({
  pattern,
  category,
  severity: "flag",
});

// ---------------------------------------------------------------------------
// BLOCK -- explicit sexual content
// ---------------------------------------------------------------------------
const EXPLICIT_TERMS: Term[] = [
  block("pornhub", "explicit"),
  block("xvideos", "explicit"),
  block("xnxx", "explicit"),
  block("redtube", "explicit"),
  block("youporn", "explicit"),
  block("onlyfans", "explicit"),
  block("camgirl", "explicit"),
  block("camboy", "explicit"),
  block("blowjob", "explicit"),
  block("handjob", "explicit"),
  block("creampie", "explicit"),
  block("bukkake", "explicit"),
  block("analsex", "explicit"),
  block("masturbat", "explicit"),
  block("jerkoff", "explicit"),
  block("orgasm", "explicit"),
  block("boner", "explicit"),
  block("nsfw", "explicit"),
  block("hentai", "explicit"),
  block("erotic", "explicit"),
  block("fetishporn", "explicit"),
  block("nudes", "explicit"),
  block("sendnudes", "explicit"),
  // TS additions: trading/asking for images, intent plus noun.
  block("wantnudes", "explicit"),
  block("tradenudes", "explicit"),
  block("sellnudes", "explicit"),
];

// Phrases that describe or invite sexual acts specifically.
const EXPLICIT_PHRASES: Term[] = [
  block("showmebreasts", "explicit"),
  block("showmetits", "explicit"),
  block("dickpic", "explicit"),
  block("sexvideo", "explicit"),
  block("sexchat", "explicit"),
  block("haveyousex", "explicit"),
  block("wantsex", "explicit"),
  block("letshavefun", "explicit"),
];

// ---------------------------------------------------------------------------
// BLOCK -- solicitation / trading / funnelling out of the platform
// ---------------------------------------------------------------------------
const SOLICITATION_TERMS: Term[] = [
  block("onlyfanslink", "solicitation"),
  block("myexploit", "solicitation"),
  block("sendmeaddr", "solicitation"),
  block("addmetelegram", "solicitation"),
  block("addmeontelegram", "solicitation"),
  block("meontelegram", "solicitation"),
  block("telegramme", "solicitation"),
  block("telegramon", "solicitation"),
  block("whatsappme", "solicitation"),
  block("whatsappon", "solicitation"),
  block("snapchatme", "solicitation"),
  block("dmmeononly", "solicitation"),
  block("privatemessageforvideo", "solicitation"),
  // TS additions: same intent on platforms the Python list did not name.
  block("addmeondiscord", "solicitation"),
  block("joinmytelegram", "solicitation"),
  block("myinsta", "solicitation"),
  block("addmeoninsta", "solicitation"),
];

// Asking where to get explicit material is the message that actually funnels
// people off the platform. The bare words are deliberately absent: "porn",
// "sex" and "relapse" are exactly what recovery disclosure is made of. These
// terms are intent plus noun, and category "explicit" (not "solicitation")
// because _RESCUABLE downgrades them to a flag when a recovery frame is
// present — someone disclosing a relapse while asking where to buy material
// is asking for help while in crisis, and must reach a moderator.
const ACQUISITION_TERMS: Term[] = [
  block("buyporn", "explicit"),
  block("buyingporn", "explicit"),
  block("pornforsale", "solicitation"),
  block("sellingporn", "solicitation"),
  block("sendmeporn", "explicit"),
  block("dmmeporn", "explicit"),
  block("anyonehaveporn", "explicit"),
  block("anyonegotporn", "explicit"),
  block("lookingforporn", "explicit"),
  block("downloadporn", "explicit"),
  block("getpornlinks", "solicitation"),
  block("wherecanidownloadporn", "explicit"),
];

// ---------------------------------------------------------------------------
// BLOCK -- encouragement / glorification of the behaviour
//
// These are the messages that keep other people addicted. Blocking them is
// the single highest-value rule in this file.
// ---------------------------------------------------------------------------
const ENCOURAGEMENT_TERMS: Term[] = [
  block("everyonewatches", "encouragement"),
  block("everyonedoesit", "encouragement"),
  block("itsfineeveryone", "encouragement"),
  block("nobodystops", "encouragement"),
  block("relapseisfine", "encouragement"),
  block("justrelapse", "encouragement"),
  block("keeprelapsing", "encouragement"),
  block("screwrecovery", "encouragement"),
  block("quitspreading", "encouragement"),
  block("weaknessnot", "encouragement"),
  block("giveinandwatch", "encouragement"),
  block("onevideoisnt", "encouragement"),
  block("nofapisoverrated", "encouragement"),
  block("pornisnormal", "encouragement"),
  block("guiltyshame", "encouragement"),
  block("watchitandrelax", "encouragement"),
];

// ---------------------------------------------------------------------------
// BLOCK -- gambling
// ---------------------------------------------------------------------------
const GAMBLING_TERMS: Term[] = [
  block("1xbet", "gambling"),
  block("betfair", "gambling"),
  block("pokerstars", "gambling"),
  block("sportsbetting", "gambling"),
  block("surebet", "gambling"),
  block("doublingmoney", "gambling"),
  block("freecasino", "gambling"),
  block("casinoonline", "gambling"),
  block("depositbonus", "gambling"),
  block("usemycode", "gambling"),
  block("telegramcasino", "gambling"),
  // TS additions: the betting brands and promo vocabulary actually seen in
  // regional spam. Gambling promotion is never rescued by a recovery frame.
  block("mostbet", "gambling"),
  block("betway", "gambling"),
  block("22bet", "gambling"),
  block("parimatch", "gambling"),
  block("melbet", "gambling"),
  block("promocode", "gambling"),
  block("freebet", "gambling"),
];

// ---------------------------------------------------------------------------
// BLOCK -- self-harm / violence
//
// Blocked from the community feed and routed to staff, because the community
// is not equipped to handle acute risk. Never rescued.
// ---------------------------------------------------------------------------
const HARM_TERMS: Term[] = [
  block("killmyself", "self_harm"),
  block("endmylife", "self_harm"),
  block("suicidemethod", "self_harm"),
  block("howmanypills", "self_harm"),
  block("wanttodie", "self_harm"),
  block("overdose", "self_harm"),
  block("killyourself", "self_harm"),
  block("hangmyself", "self_harm"),
  // TS additions: first-person intent, matching the Arabic tier below. The
  // bare noun "self harm" stays unblocked — naming a condition is disclosure.
  block("cutmyself", "self_harm"),
  block("hurtmyself", "self_harm"),
  block("betteroffdead", "self_harm"),
  block("iwannadie", "self_harm"),
];

// ---------------------------------------------------------------------------
// FLAG -- ambiguous, allowed but logged for staff review
// ---------------------------------------------------------------------------
const ENGLISH_FLAG_TERMS: Term[] = [
  flag("ihate myself", "self_hostility"),
  flag("ihateeverything", "self_hostility"),
  flag("worthless", "self_hostility"),
  flag("disgustingperson", "self_hostility"),
  flag("sendmoney", "scam"),
  flag("wiretransfer", "scam"),
  flag("crypto giveaway", "scam"),
  flag("doublingyour", "scam"),
  flag("investmentopportunity", "scam"),
  flag("telegram", "offplatform"),
  flag("whatsappgroup", "offplatform"),
  // TS additions: bare group mention and the remittance brands used in the
  // "send me the transfer" script.
  flag("telegramgroup", "offplatform"),
  flag("giftcard", "scam"),
  flag("westernunion", "scam"),
  flag("moneygram", "scam"),
];

// ---------------------------------------------------------------------------
// ALLOW -- recovery vocabulary. Never scored.
//
// Present as documentation and as a regression guard: if a future change
// adds one of these to a BLOCK list, it has stopped being a recovery lexicon.
// ---------------------------------------------------------------------------
const ENGLISH_RECOVERY_SAFE: string[] = [
  "relapse", "relapsed", "relapsing",
  "porn", "pornography", "pornaddiction",
  "struggling", "struggle", "relapse", "lapse",
  "urge", "urges", "craving", "cravings", "trigger", "triggers",
  "clean", "streak", "daysclean", "dayone", "sobriety",
  "nofap", "pornfree", "quit", "quitting", "withdrawal",
  "accountability", "sponsor", "therapist", "recovery", "rehab",
  "shame", "guilt", "hopeless", "hopelessness", "depressed",
  "help", "pleasehelp", "support", "felloff", "failed",
];

// ---------------------------------------------------------------------------
// BLOCK -- harassment / slurs aimed at another member
//
// Split by intent rather than by language: dehumanising and sexual slurs are
// blocked outright, ordinary insults are only flagged.
// ---------------------------------------------------------------------------
const HARASSMENT_TERMS: Term[] = [
  block("يا ابن الكلب", "harassment"),
  // The same slur without the vocative, which is how it is usually typed
  // ("انت ابن كلب").
  block("ابن الكلب", "harassment"),
  block("ابن كلب", "harassment"),
  block("بنت الكلب", "harassment"),
  block("بنت كلب", "harassment"),
  block("يا شرموط", "harassment"),
  block("شرموطة", "harassment"),
  block("يا عاهرة", "harassment"),
  block("ابن القحبة", "harassment"),
  block("يا قحبة", "harassment"),
  block("يا معرص", "harassment"),
  block("يا منوك", "harassment"),
  block("يا خول", "harassment"),
  // TS additions: the same register, same intent.
  block("يا عرص", "harassment"),
  block("يا لبوة", "harassment"),
  block("يا ابن لبوة", "harassment"),
  block("يا ابن الوسخة", "harassment"),
];

// ---------------------------------------------------------------------------
// Arabic coverage
//
// The community is Arabic-first. normalize() folds hamza and the round-ta, so
// every pattern below is written in ordinary spelling and matched regardless
// of how the member typed it.
// ---------------------------------------------------------------------------

// Directed at a member, acute risk, or method-seeking. self_harm is never
// rescued and always scores critical, matching the English tier above.
const ARABIC_HARM_TERMS: Term[] = [
  block("أموت نفسي", "self_harm"),
  block("اقتل نفسي", "self_harm"),
  block("عايز أموت", "self_harm"),
  block("عايزة أموت", "self_harm"),
  block("ودي أموت", "self_harm"),
  block("أنهي حياتي", "self_harm"),
  block("شنق نفسي", "self_harm"),
  block("أجرح نفسي", "self_harm"),
  block("أذي نفسي", "self_harm"),
  block("انتحر", "self_harm"),
  block("هنتحر", "self_harm"),
  block("طريقة الانتحار", "self_harm"),
  block("روح موت نفسك", "self_harm"),
  block("اقتل نفسك", "self_harm"),
  // TS additions: first-person intent phrased the way it is actually typed.
  block("بفكر اقتل نفسي", "self_harm"),
  block("هقتل نفسي", "self_harm"),
  block("عايز اقتل نفسي", "self_harm"),
  block("عايزة اقتل نفسي", "self_harm"),
  block("مش عايز اعيش", "self_harm"),
  block("مش عايزة اعيش", "self_harm"),
];

// Normalising or encouraging the behaviour for other people. Never rescued,
// because the frame is aimed outward rather than at the author's own recovery.
const ARABIC_ENCOURAGEMENT_TERMS: Term[] = [
  block("كل الناس بتتفرج", "encouragement"),
  block("كل الناس بتعمل كده", "encouragement"),
  block("الإباحية عادية", "encouragement"),
  block("الإباحية طبيعية", "encouragement"),
  block("محدش بيبطل", "encouragement"),
  block("التعافي ملوش لازمة", "encouragement"),
  block("ارجع اتفرج", "encouragement"),
  // TS additions: the same minimising script about the habit itself.
  block("العادة السرية عادية", "encouragement"),
  block("العادة السرية طبيعية", "encouragement"),
  block("العادة السرية صحية", "encouragement"),
  block("مفيش مشكلة تتفرج", "encouragement"),
  block("مرة واحدة مش هتفرق", "encouragement"),
];

// Funnelling members off the platform, which is where the abuse actually starts.
const ARABIC_SOLICITATION_TERMS: Term[] = [
  block("ضيفني على تليجرام", "solicitation"),
  block("ضيفني تليجرام", "solicitation"),
  block("كلمني على واتساب", "solicitation"),
  block("عندي جروب تليجرام", "solicitation"),
  block("ابعتلي على الخاص", "solicitation"),
  block("هبعترك صور", "explicit"),
  block("ابعتلك فيديو إباحي", "explicit"),
  // TS additions: the same move-the-conversation-private script.
  block("كلمني على الخاص", "solicitation"),
  block("ابعتلي في الخاص", "solicitation"),
];

// Intent plus noun, following ACQUISITION_TERMS above. The bare word "إباحية"
// stays unblocked: naming the addiction is what recovery disclosure is made of.
const ARABIC_ACQUISITION_TERMS: Term[] = [
  block("عايز أفلام إباحية", "explicit"),
  block("عايزة مقاطع إباحية", "explicit"),
  block("مواقع إباحية مجانية", "explicit"),
  block("رابط موقع إباحي", "explicit"),
  block("مقاطع إباحية للتحميل", "solicitation"),
  block("دور على أفلام إباحية", "explicit"),
  block("ابغى مقاطع إباحية", "explicit"),
  // TS additions: the same intent using the transliterated "سكس" spelling.
  block("عايز فيديو سكس", "explicit"),
  block("عايز صور سكس", "explicit"),
  block("عايزة فيديوهات سكس", "explicit"),
  block("لينك افلام سكس", "explicit"),
  block("رابط افلام سكس", "explicit"),
  block("مواقع سكس مجانية", "explicit"),
  block("عايز مواقع سكس", "explicit"),
  block("افلام سكس للتحميل", "solicitation"),
  block("مقاطع سكس للتحميل", "solicitation"),
  block("عايز صور عريانة", "explicit"),
];

const ARABIC_GAMBLING_TERMS: Term[] = [
  block("موقع مراهنات", "gambling"),
  block("كازينو أونلاين", "gambling"),
  block("قمار أونلاين", "gambling"),
  block("رهان مضمون", "gambling"),
  block("ضاعف فلوسك", "gambling"),
  // TS additions: promo-code spam as it appears in Arabic feeds.
  block("برومو كود", "gambling"),
  block("موقع قمار", "gambling"),
];

// Ordinary insults: logged and surfaced in the console, not walled off.
const ARABIC_INSULT_TERMS: Term[] = [
  flag("يا كلب", "harassment"),
  flag("يا حمار", "harassment"),
  flag("يا غبي", "harassment"),
  flag("يا غبية", "harassment"),
  flag("يا عبيط", "harassment"),
  flag("يا حقير", "harassment"),
  flag("يا تافه", "harassment"),
  flag("يا وسخ", "harassment"),
  flag("يا زبالة", "harassment"),
  flag("انت غبي", "harassment"),
  // TS additions: same register, still short of a slur.
  flag("يا حيوان", "harassment"),
  flag("يا بهيم", "harassment"),
];

const ARABIC_FLAG_TERMS: Term[] = [
  flag("بكره نفسي", "self_hostility"),
  flag("أنا مقرف", "self_hostility"),
  flag("أنا زبالة", "self_hostility"),
  flag("مليش لازمة", "self_hostility"),
  flag("بكره حياتي", "self_hostility"),
  flag("تليجرام", "offplatform"),
  flag("تيليجرام", "offplatform"),
  flag("واتساب", "offplatform"),
  flag("جروب واتساب", "offplatform"),
  flag("سناب شات", "offplatform"),
  flag("رقمك كام", "offplatform"),
  flag("ابعت فلوس", "scam"),
  flag("تحويل فلوس", "scam"),
  flag("استثمار مضمون", "scam"),
  // TS additions: despair phrasing short of acute intent, and the platform /
  // payout names used in off-platform and money scripts.
  flag("زهقت من الحياة", "self_hostility"),
  flag("زهقت من حياتي", "self_hostility"),
  flag("مش قادر اكمل", "self_hostility"),
  flag("انستجرام", "offplatform"),
  flag("فيسبوك", "offplatform"),
  flag("تيك توك", "offplatform"),
  flag("فودافون كاش", "scam"),
  flag("انستا باي", "scam"),
  flag("ويسترن يونيون", "scam"),
];

// Recovery vocabulary in Arabic. Same role as RECOVERY_SAFE: documentation and
// a regression guard against a future edit blocking disclosure.
const ARABIC_RECOVERY_SAFE: string[] = [
  "انتكاسة", "انتكست", "إدمان", "مدمن", "إباحية", "عادة سرية",
  "شهوة", "تعافي", "نظيف", "رغبة", "محفزات", "علاج", "دعم",
  "مساعدة", "ساعدوني", "خجل", "ذنب", "اكتئاب", "بطلت", "مصحة",
];

export const BLOCK_TERMS: Term[] = [
  ...EXPLICIT_TERMS,
  ...EXPLICIT_PHRASES,
  ...SOLICITATION_TERMS,
  ...ACQUISITION_TERMS,
  ...ENCOURAGEMENT_TERMS,
  ...GAMBLING_TERMS,
  ...HARM_TERMS,
  ...HARASSMENT_TERMS,
  ...ARABIC_HARM_TERMS,
  ...ARABIC_ENCOURAGEMENT_TERMS,
  ...ARABIC_SOLICITATION_TERMS,
  ...ARABIC_ACQUISITION_TERMS,
  ...ARABIC_GAMBLING_TERMS,
];

export const FLAG_TERMS: Term[] = [
  ...ENGLISH_FLAG_TERMS,
  ...ARABIC_INSULT_TERMS,
  ...ARABIC_FLAG_TERMS,
];

export const RECOVERY_SAFE: string[] = [
  ...ENGLISH_RECOVERY_SAFE,
  ...ARABIC_RECOVERY_SAFE,
];
