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
]

# ---------------------------------------------------------------------------
# FLAG -- ambiguous, allowed but logged for staff review
# ---------------------------------------------------------------------------
FLAG_TERMS: list[Term] = [
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
]

# ---------------------------------------------------------------------------
# ALLOW -- recovery vocabulary. Never scored.
#
# Present as documentation and as a regression guard: if a future change
# adds one of these to a BLOCK list, the test suite fails.
# ---------------------------------------------------------------------------
RECOVERY_SAFE: list[str] = [
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

BLOCK_TERMS: list[Term] = (
    EXPLICIT_TERMS
    + EXPLICIT_PHRASES
    + SOLICITATION_TERMS
    + ACQUISITION_TERMS
    + ENCOURAGEMENT_TERMS
    + GAMBLING_TERMS
    + HARM_TERMS
)
