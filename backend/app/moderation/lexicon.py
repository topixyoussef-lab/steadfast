"""Tiered moderation lexicon.

Design note
-----------
This is a *recovery* community, so the obvious approach -- block words like
"relapse", "porn" or "struggling" -- would be actively harmful. People need to
be able to name their addiction and ask for help in public.

So the lexicon separates three things:

BLOCK   explicit sexual content, solicitation/trading, encouragement or
        glorification of the behaviour, gambling promotion, self-harm
        instructions, and slurs/harassment aimed at another member.
FLAG   ambiguous risk: unvetted outbound links, money talk, self-directed
        hostility. Allowed through, logged, visible to admins.
ALLOW   recovery vocabulary. Explicitly never scored, so the engine can
        never penalise someone for asking for help.

When in doubt this file errs toward ALLOW, and the OpenAI layer in `hybrid`
mode is what catches novel slang.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Term:
    pattern: str
    category: str
    severity: str  # "block" | "flag"


# ---------------------------------------------------------------------------
# BLOCK -- explicit sexual content
# ---------------------------------------------------------------------------
EXPLICIT_TERMS: list[Term] = [
    Term("pornhub", "explicit", "block"),
    Term("xvideos", "explicit", "block"),
    Term("xnxx", "explicit", "block"),
    Term("redtube", "explicit", "block"),
    Term("youporn", "explicit", "block"),
    Term("onlyfans", "explicit", "block"),
    Term("camgirl", "explicit", "block"),
    Term("camboy", "explicit", "block"),
    Term("blowjob", "explicit", "block"),
    Term("handjob", "explicit", "block"),
    Term("creampie", "explicit", "block"),
    Term("bukkake", "explicit", "block"),
    Term("analsex", "explicit", "block"),
    Term("masturbat", "explicit", "block"),
    Term("jerkoff", "explicit", "block"),
    Term("orgasm", "explicit", "block"),
    Term("boner", "explicit", "block"),
    Term("nsfw", "explicit", "block"),
    Term("hentai", "explicit", "block"),
    Term("erotic", "explicit", "block"),
    Term("fetishporn", "explicit", "block"),
    Term("nudes", "explicit", "block"),
    Term("sendnudes", "explicit", "block"),
    # TS parity: trading/asking for images, intent plus noun.
    Term("wantnudes", "explicit", "block"),
    Term("tradenudes", "explicit", "block"),
    Term("sellnudes", "explicit", "block"),
]

# Phrases that describe or invite sexual acts specifically.
EXPLICIT_PHRASES: list[Term] = [
    Term("showmebreasts", "explicit", "block"),
    Term("showmetits", "explicit", "block"),
    Term("dickpic", "explicit", "block"),
    Term("sexvideo", "explicit", "block"),
    Term("sexchat", "explicit", "block"),
    Term("haveyousex", "explicit", "block"),
    Term("wantsex", "explicit", "block"),
    Term("letshavefun", "explicit", "block"),
]

# ---------------------------------------------------------------------------
# BLOCK -- solicitation / trading / funnelling out of the platform
# ---------------------------------------------------------------------------
SOLICITATION_TERMS: list[Term] = [
    Term("onlyfanslink", "solicitation", "block"),
    Term("myexploit", "solicitation", "block"),
    Term("sendmeaddr", "solicitation", "block"),
    Term("addmetelegram", "solicitation", "block"),
    Term("addmeontelegram", "solicitation", "block"),
    Term("meontelegram", "solicitation", "block"),
    Term("telegramme", "solicitation", "block"),
    Term("telegramon", "solicitation", "block"),
    Term("whatsappme", "solicitation", "block"),
    Term("whatsappon", "solicitation", "block"),
    Term("snapchatme", "solicitation", "block"),
    Term("dmmeononly", "solicitation", "block"),
    Term("privatemessageforvideo", "solicitation", "block"),
    # TS parity: same intent on platforms the list did not name.
    Term("addmeondiscord", "solicitation", "block"),
    Term("joinmytelegram", "solicitation", "block"),
    Term("myinsta", "solicitation", "block"),
    Term("addmeoninsta", "solicitation", "block"),
]

# Asking where to get explicit material is the message that actually funnels
# people off the platform, and it is the one thing the bare nouns cannot cover.
#
# The bare words are deliberately absent from this file. "porn", "sex" and
# "relapse" are exactly what recovery disclosure is made of, so blocking them
# would silence the people this community exists for. What separates an attack
# from honest disclosure is not the noun, it is the acquisition intent, so
# these terms are intent plus noun.
#
# normalize() strips spaces, punctuation and leet substitutions, and the engine
# also matches against squeeze(normalize(...)), so a single "buyporn" entry
# catches "buy porn", "b u y p o r n", "p.o.o.r.n" and "buyp0rn" alike.
#
# "buyporn" is intentionally narrow: a bare "wherecanibuy" would also block
# "where can I buy a rosary" and "where can I buy methadone", which are
# ordinary recovery messages.
#
# Category is "explicit", not "solicitation". Solicitation means getting other
# people off the platform and is never rescued. Someone who writes "i relapsed
# again, where can i buy porn" is asking for help while in crisis, so these
# belong with the explicit terms that _RESCUABLE downgrades to a flag when a
# recovery frame is present. Flagged still reaches a moderator.
ACQUISITION_TERMS: list[Term] = [
    Term("buyporn", "explicit", "block"),
    Term("buyingporn", "explicit", "block"),
    Term("pornforsale", "solicitation", "block"),
    Term("sellingporn", "solicitation", "block"),
    Term("sendmeporn", "explicit", "block"),
    Term("dmmeporn", "explicit", "block"),
    Term("anyonehaveporn", "explicit", "block"),
    Term("anyonegotporn", "explicit", "block"),
    Term("lookingforporn", "explicit", "block"),
    Term("downloadporn", "explicit", "block"),
    Term("getpornlinks", "solicitation", "block"),
    Term("wherecanidownloadporn", "explicit", "block"),
]

# ---------------------------------------------------------------------------
# BLOCK -- encouragement / glorification of the behaviour
#
# These are the messages that keep other people addicted. Blocking them is
# the single highest-value rule in this file.
# ---------------------------------------------------------------------------
ENCOURAGEMENT_TERMS: list[Term] = [
    Term("everyonewatches", "encouragement", "block"),
    Term("everyonedoesit", "encouragement", "block"),
    Term("itsfineeveryone", "encouragement", "block"),
    Term("nobodystops", "encouragement", "block"),
    Term("relapseisfine", "encouragement", "block"),
    Term("justrelapse", "encouragement", "block"),
    Term("keeprelapsing", "encouragement", "block"),
    Term("screwrecovery", "encouragement", "block"),
    Term("quitspreading", "encouragement", "block"),
    Term("weaknessnot", "encouragement", "block"),
    Term("giveinandwatch", "encouragement", "block"),
    Term("onevideoisnt", "encouragement", "block"),
    Term("nofapisoverrated", "encouragement", "block"),
    Term("pornisnormal", "encouragement", "block"),
    Term("guiltyshame", "encouragement", "block"),
    Term("watchitandrelax", "encouragement", "block"),
]

# ---------------------------------------------------------------------------
# BLOCK -- gambling
# ---------------------------------------------------------------------------
GAMBLING_TERMS: list[Term] = [
    Term("1xbet", "gambling", "block"),
    Term("betfair", "gambling", "block"),
    Term("pokerstars", "gambling", "block"),
    Term("sportsbetting", "gambling", "block"),
    Term("surebet", "gambling", "block"),
    Term("doublingmoney", "gambling", "block"),
    Term("freecasino", "gambling", "block"),
    Term("casinoonline", "gambling", "block"),
    Term("depositbonus", "gambling", "block"),
    Term("usemycode", "gambling", "block"),
    Term("telegramcasino", "gambling", "block"),
    # TS parity: the betting brands and promo vocabulary actually seen in
    # regional spam.
    Term("mostbet", "gambling", "block"),
    Term("betway", "gambling", "block"),
    Term("22bet", "gambling", "block"),
    Term("parimatch", "gambling", "block"),
    Term("melbet", "gambling", "block"),
    Term("promocode", "gambling", "block"),
    Term("freebet", "gambling", "block"),
]

# ---------------------------------------------------------------------------
# BLOCK -- self-harm / violence
#
# These are blocked from the community feed and routed to staff, because the
# community is not equipped to handle acute risk.
# ---------------------------------------------------------------------------
HARM_TERMS: list[Term] = [
    Term("killmyself", "self_harm", "block"),
    Term("endmylife", "self_harm", "block"),
    Term("suicidemethod", "self_harm", "block"),
    Term("howmanypills", "self_harm", "block"),
    Term("wanttodie", "self_harm", "block"),
    Term("overdose", "self_harm", "block"),
    Term("killyourself", "self_harm", "block"),
    Term("hangmyself", "self_harm", "block"),
    # TS parity: first-person intent, matching the Arabic tier below. The
    # bare noun "self harm" stays unblocked — naming a condition is disclosure.
    Term("cutmyself", "self_harm", "block"),
    Term("hurtmyself", "self_harm", "block"),
    Term("betteroffdead", "self_harm", "block"),
    Term("iwannadie", "self_harm", "block"),
]

# ---------------------------------------------------------------------------
# FLAG -- ambiguous, allowed but logged for staff review
# ---------------------------------------------------------------------------
ENGLISH_FLAG_TERMS: list[Term] = [
    Term("ihate myself", "self_hostility", "flag"),
    Term("ihateeverything", "self_hostility", "flag"),
    Term("worthless", "self_hostility", "flag"),
    Term("disgustingperson", "self_hostility", "flag"),
    Term("sendmoney", "scam", "flag"),
    Term("wiretransfer", "scam", "flag"),
    Term("crypto giveaway", "scam", "flag"),
    Term("doublingyour", "scam", "flag"),
    Term("investmentopportunity", "scam", "flag"),
    Term("telegram", "offplatform", "flag"),
    Term("whatsappgroup", "offplatform", "flag"),
    # TS parity: bare group mention and the remittance brands used in the
    # "send me the transfer" script.
    Term("telegramgroup", "offplatform", "flag"),
    Term("giftcard", "scam", "flag"),
    Term("westernunion", "scam", "flag"),
    Term("moneygram", "scam", "flag"),
]

# ---------------------------------------------------------------------------
# ALLOW -- recovery vocabulary. Never scored.
#
# Present as documentation and as a regression guard: if a future change
# adds one of these to a BLOCK list, the test suite fails.
# ---------------------------------------------------------------------------
ENGLISH_RECOVERY_SAFE: list[str] = [
    "relapse", "relapsed", "relapsing",
    "porn", "pornography", "pornaddiction",
    "struggling", "struggle", "relapse", "lapse",
    "urge", "urges", "craving", "cravings", "trigger", "triggers",
    "clean", "streak", "daysclean", "dayone", "sobriety",
    "nofap", "pornfree", "quit", "quitting", "withdrawal",
    "accountability", "sponsor", "therapist", "recovery", "rehab",
    "shame", "guilt", "hopeless", "hopelessness", "depressed",
    "help", "pleasehelp", "support", "felloff", "failed",
]

# ---------------------------------------------------------------------------
# BLOCK -- harassment / slurs aimed at another member
#
# The docstring above has always promised this tier exists; these are the terms.
# Split by intent rather than by language: dehumanising and sexual slurs are
# blocked outright, ordinary insults are only flagged. A member having a bad
# night who calls someone an idiot is not the same event as a slur, and in a
# recovery community the cost of silencing the first is higher than the cost of
# letting a moderator read it.
# ---------------------------------------------------------------------------
HARASSMENT_TERMS: list[Term] = [
    Term("يا ابن الكلب", "harassment", "block"),
    # The same slur without the vocative, which is how it is usually typed
    # ("انت ابن كلب"). These read as "son of a dog" in ordinary speech; the
    # engine's mask pass is what turns them into "انت ابن كل*" as well.
    Term("ابن الكلب", "harassment", "block"),
    Term("ابن كلب", "harassment", "block"),
    Term("بنت الكلب", "harassment", "block"),
    Term("بنت كلب", "harassment", "block"),
    Term("يا شرموط", "harassment", "block"),
    Term("شرموطة", "harassment", "block"),
    Term("يا عاهرة", "harassment", "block"),
    Term("ابن القحبة", "harassment", "block"),
    Term("يا قحبة", "harassment", "block"),
    Term("يا معرص", "harassment", "block"),
    Term("يا منوك", "harassment", "block"),
    Term("يا خول", "harassment", "block"),
    # TS parity: the same register, same intent.
    Term("يا عرص", "harassment", "block"),
    Term("يا لبوة", "harassment", "block"),
    Term("يا ابن لبوة", "harassment", "block"),
    Term("يا ابن الوسخة", "harassment", "block"),
]

# ---------------------------------------------------------------------------
# Arabic coverage
#
# The community is Arabic-first, so an English-only list means the moderation
# engine effectively reads nothing most members write. normalize() folds hamza
# and the round-ta, so every pattern below is written in ordinary spelling and
# matched regardless of how the member typed it.
# ---------------------------------------------------------------------------

# Directed at a member, acute risk, or method-seeking. self_harm is never
# rescued and always scores critical, matching the English tier above.
ARABIC_HARM_TERMS: list[Term] = [
    Term("أموت نفسي", "self_harm", "block"),
    Term("اقتل نفسي", "self_harm", "block"),
    Term("عايز أموت", "self_harm", "block"),
    Term("عايزة أموت", "self_harm", "block"),
    Term("ودي أموت", "self_harm", "block"),
    Term("أنهي حياتي", "self_harm", "block"),
    Term("شنق نفسي", "self_harm", "block"),
    Term("أجرح نفسي", "self_harm", "block"),
    Term("أذي نفسي", "self_harm", "block"),
    Term("انتحر", "self_harm", "block"),
    Term("هنتحر", "self_harm", "block"),
    Term("طريقة الانتحار", "self_harm", "block"),
    Term("روح موت نفسك", "self_harm", "block"),
    Term("اقتل نفسك", "self_harm", "block"),
    # TS parity: first-person intent phrased the way it is actually typed.
    Term("بفكر اقتل نفسي", "self_harm", "block"),
    Term("هقتل نفسي", "self_harm", "block"),
    Term("عايز اقتل نفسي", "self_harm", "block"),
    Term("عايزة اقتل نفسي", "self_harm", "block"),
    Term("مش عايز اعيش", "self_harm", "block"),
    Term("مش عايزة اعيش", "self_harm", "block"),
]

# Normalising or encouraging the behaviour for other people. Never rescued,
# because the frame is aimed outward rather than at the author's own recovery.
ARABIC_ENCOURAGEMENT_TERMS: list[Term] = [
    Term("كل الناس بتتفرج", "encouragement", "block"),
    Term("كل الناس بتعمل كده", "encouragement", "block"),
    Term("الإباحية عادية", "encouragement", "block"),
    Term("الإباحية طبيعية", "encouragement", "block"),
    Term("محدش بيبطل", "encouragement", "block"),
    Term("التعافي ملوش لازمة", "encouragement", "block"),
    Term("ارجع اتفرج", "encouragement", "block"),
    # TS parity: the same minimising script about the habit itself.
    Term("العادة السرية عادية", "encouragement", "block"),
    Term("العادة السرية طبيعية", "encouragement", "block"),
    Term("العادة السرية صحية", "encouragement", "block"),
    Term("مفيش مشكلة تتفرج", "encouragement", "block"),
    Term("مرة واحدة مش هتفرق", "encouragement", "block"),
]

# Funnelling members off the platform, which is where the abuse actually starts.
ARABIC_SOLICITATION_TERMS: list[Term] = [
    Term("ضيفني على تليجرام", "solicitation", "block"),
    Term("ضيفني تليجرام", "solicitation", "block"),
    Term("كلمني على واتساب", "solicitation", "block"),
    Term("عندي جروب تليجرام", "solicitation", "block"),
    Term("ابعتلي على الخاص", "solicitation", "block"),
    Term("هبعترك صور", "explicit", "block"),
    Term("ابعتلك فيديو إباحي", "explicit", "block"),
    # TS parity: the same move-the-conversation-private script.
    Term("كلمني على الخاص", "solicitation", "block"),
    Term("ابعتلي في الخاص", "solicitation", "block"),
]

# Intent plus noun, following ACQUISITION_TERMS above. The bare word "إباحية"
# stays unblocked: naming the addiction is what recovery disclosure is made of.
ARABIC_ACQUISITION_TERMS: list[Term] = [
    Term("عايز أفلام إباحية", "explicit", "block"),
    Term("عايزة مقاطع إباحية", "explicit", "block"),
    Term("مواقع إباحية مجانية", "explicit", "block"),
    Term("رابط موقع إباحي", "explicit", "block"),
    Term("مقاطع إباحية للتحميل", "solicitation", "block"),
    Term("دور على أفلام إباحية", "explicit", "block"),
    Term("ابغى مقاطع إباحية", "explicit", "block"),
    # TS parity: the same intent using the transliterated "سكس" spelling.
    Term("عايز فيديو سكس", "explicit", "block"),
    Term("عايز صور سكس", "explicit", "block"),
    Term("عايزة فيديوهات سكس", "explicit", "block"),
    Term("لينك افلام سكس", "explicit", "block"),
    Term("رابط افلام سكس", "explicit", "block"),
    Term("مواقع سكس مجانية", "explicit", "block"),
    Term("عايز مواقع سكس", "explicit", "block"),
    Term("افلام سكس للتحميل", "solicitation", "block"),
    Term("مقاطع سكس للتحميل", "solicitation", "block"),
    Term("عايز صور عريانة", "explicit", "block"),
]

ARABIC_GAMBLING_TERMS: list[Term] = [
    Term("موقع مراهنات", "gambling", "block"),
    Term("كازينو أونلاين", "gambling", "block"),
    Term("قمار أونلاين", "gambling", "block"),
    Term("رهان مضمون", "gambling", "block"),
    Term("ضاعف فلوسك", "gambling", "block"),
    # TS parity: promo-code spam as it appears in Arabic feeds.
    Term("برومو كود", "gambling", "block"),
    Term("موقع قمار", "gambling", "block"),
]

# Ordinary insults: logged and surfaced in the console, not walled off.
ARABIC_INSULT_TERMS: list[Term] = [
    Term("يا كلب", "harassment", "flag"),
    Term("يا حمار", "harassment", "flag"),
    Term("يا غبي", "harassment", "flag"),
    Term("يا غبية", "harassment", "flag"),
    Term("يا عبيط", "harassment", "flag"),
    Term("يا حقير", "harassment", "flag"),
    Term("يا تافه", "harassment", "flag"),
    Term("يا وسخ", "harassment", "flag"),
    Term("يا زبالة", "harassment", "flag"),
    Term("انت غبي", "harassment", "flag"),
    # TS parity: same register, still short of a slur.
    Term("يا حيوان", "harassment", "flag"),
    Term("يا بهيم", "harassment", "flag"),
]

ARABIC_FLAG_TERMS: list[Term] = [
    Term("بكره نفسي", "self_hostility", "flag"),
    Term("أنا مقرف", "self_hostility", "flag"),
    Term("أنا زبالة", "self_hostility", "flag"),
    Term("مليش لازمة", "self_hostility", "flag"),
    Term("بكره حياتي", "self_hostility", "flag"),
    Term("تليجرام", "offplatform", "flag"),
    Term("تيليجرام", "offplatform", "flag"),
    Term("واتساب", "offplatform", "flag"),
    Term("جروب واتساب", "offplatform", "flag"),
    Term("سناب شات", "offplatform", "flag"),
    Term("رقمك كام", "offplatform", "flag"),
    Term("ابعت فلوس", "scam", "flag"),
    Term("تحويل فلوس", "scam", "flag"),
    Term("استثمار مضمون", "scam", "flag"),
    # TS parity: despair phrasing short of acute intent, and the platform /
    # payout names used in off-platform and money scripts.
    Term("زهقت من الحياة", "self_hostility", "flag"),
    Term("زهقت من حياتي", "self_hostility", "flag"),
    Term("مش قادر اكمل", "self_hostility", "flag"),
    Term("انستجرام", "offplatform", "flag"),
    Term("فيسبوك", "offplatform", "flag"),
    Term("تيك توك", "offplatform", "flag"),
    Term("فودافون كاش", "scam", "flag"),
    Term("انستا باي", "scam", "flag"),
    Term("ويسترن يونيون", "scam", "flag"),
]

# Recovery vocabulary in Arabic. Same role as RECOVERY_SAFE: documentation and
# a regression guard against a future edit blocking disclosure.
ARABIC_RECOVERY_SAFE: list[str] = [
    "انتكاسة", "انتكست", "إدمان", "مدمن", "إباحية", "عادة سرية",
    "شهوة", "تعافي", "نظيف", "رغبة", "محفزات", "علاج", "دعم",
    "مساعدة", "ساعدوني", "خجل", "ذنب", "اكتئاب", "بطلت", "مصحة",
]

BLOCK_TERMS: list[Term] = (
    EXPLICIT_TERMS
    + EXPLICIT_PHRASES
    + SOLICITATION_TERMS
    + ACQUISITION_TERMS
    + ENCOURAGEMENT_TERMS
    + GAMBLING_TERMS
    + HARM_TERMS
    + HARASSMENT_TERMS
    + ARABIC_HARM_TERMS
    + ARABIC_ENCOURAGEMENT_TERMS
    + ARABIC_SOLICITATION_TERMS
    + ARABIC_ACQUISITION_TERMS
    + ARABIC_GAMBLING_TERMS
)

FLAG_TERMS: list[Term] = (
    ENGLISH_FLAG_TERMS
    + ARABIC_INSULT_TERMS
    + ARABIC_FLAG_TERMS
)

RECOVERY_SAFE: list[str] = [*ENGLISH_RECOVERY_SAFE, *ARABIC_RECOVERY_SAFE]
