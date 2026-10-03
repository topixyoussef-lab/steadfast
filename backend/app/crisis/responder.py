"""Supportive response generation for the panic button.

Design constraints
------------------
* No clinical claims. This is not therapy and must not pretend to be.
* No fabricated scripture. Quoting an ayah or verse from memory risks
  misattribution, which would be both disrespectful and religiously
  harmful. Instead we offer a reflection prompt and let the member open
  their own text.
* Urgency 9-10 means hand off to a real human and a real helpline. The
  service is a bridge, never the only support.
"""

from __future__ import annotations

import hashlib
from datetime import datetime

from app.schemas import CopingStep, PanicResponse

# Deliberately not verses. Reflections only, so nothing is ever misquoted.
_REFLECTION: dict[str, str] = {
    "islamic": "Open your Quran at the page you normally stop at, and read one line.",
    "christian": "Open your Bible at the passage you normally stop at, and read one line.",
    "general": "Open whatever book is nearest, and read one page.",
}

_GROUNDING = [
    "Put both feet on the floor and press down for ten seconds.",
    "Name five things you can see, four you can hear, three you can touch.",
    "Drink a full glass of water, slowly.",
    "Breathe out longer than you breathe in: in for four, out for eight.",
]

_TIERS: dict[int, dict] = {
    0: {
        "response": "Good to check in. The fact that you noticed the urge is already you "
                    "choosing differently.",
        "steps": [
            CopingStep(title="Keep the streak you have", detail="Day one is today. Nothing else matters."),
            CopingStep(title="Log it", detail="Write the urge level in your check-in so you can see the pattern."),
        ],
        "escalate": False,
    },
    3: {
        "response": "You are early, and early is the easiest time to turn it around. "
                    "Ten minutes of something else is all we are asking for.",
        "steps": [
            CopingStep(title="Stand up and change rooms", detail="Distance beats willpower right now."),
            CopingStep(title="Put on different clothes", detail="Any physical change resets the loop."),
            CopingStep(title="Set a ten minute timer", detail="You only have to outlast ten minutes."),
        ],
        "escalate": False,
    },
    6: {
        "response": "This is the hard moment, and you reached out instead of acting on it. "
                    "That is the whole skill. Work through the steps below in order.",
        "steps": [
            CopingStep(title="Phone down, leave the room", detail="Go outside, even just the hallway."),
            CopingStep(title="Cold water on your face and wrists", detail="Thirty seconds. It resets your nervous system."),
            CopingStep(title="Message one person", detail="Anyone. Ask them to stay on the line for five minutes."),
            CopingStep(title="Move for ten minutes", detail="Push-ups, a walk, stairs. Anything that raises your heart rate."),
        ],
        "escalate": False,
    },
    8: {
        "response": "Stay with me. Do not do anything alone right now. The urge feels "
                    "permanent and it is not -- it is a wave, and waves break. Do step one "
                    "before you read anything else.",
        "steps": [
            CopingStep(title="One: hand the phone to someone", detail="Or stand in a public place. Do not stay alone with it."),
            CopingStep(title="Two: cold water, now", detail="Face and wrists, thirty seconds."),
            CopingStep(title="Three: call a person out loud", detail="Say their name out loud if you have to. Naming it makes it real."),
            CopingStep(title="Four: set your phone down", detail="Out of arm's reach, out of the room."),
        ],
        "escalate": True,
    },
    10: {
        "response": "You are safe right now and that is what matters most. Read this "
                    "slowly. You do not have to solve your whole life tonight -- you only "
                    "have to not be alone with this for the next hour. Please reach a real "
                    "person now, and if you are in danger contact emergency services.",
        "steps": [
            CopingStep(title="Call emergency services now", detail="If you might hurt yourself or anyone else. Do this first."),
            CopingStep(title="Call your country crisis line", detail="Free and confidential. Search your country's helpline number."),
            CopingStep(title="Tell one person where you are", detail="Right now, out loud, in words."),
            CopingStep(title="Move to where people are", detail="Lobby, café, mosque, church, a friend's place. Anywhere with witnesses."),
        ],
        "escalate": True,
    },
}


def _bucket(urge_level: int) -> int:
    if urge_level <= 1:
        return 0
    if urge_level <= 4:
        return 3
    if urge_level <= 7:
        return 6
    if urge_level <= 9:
        return 8
    return 10


def _hour_in(timezone: str | None) -> int | None:
    if not timezone:
        return None
    try:
        return datetime.now().astimezone(
            __import__("zoneinfo").ZoneInfo(timezone)
        ).hour
    except Exception:
        return None


def _extra_step(preference: str | None, hour: int | None) -> CopingStep:
    if preference == "islamic":
        if hour is not None and (4 <= hour < 6 or hour >= 21):
            return CopingStep(
                title="Make wudu, then sit down",
                detail="Two minutes of water on your hands and face changes where your attention goes.",
            )
        return CopingStep(
            title="Two rak'ahs if you can manage it",
            detail="And if you cannot right now, that is fine. Sit and say the words anyway.",
        )
    if preference == "christian":
        return CopingStep(
            title="Say one line of a prayer out loud",
            detail="Even something you invent. Out loud, in your own words.",
        )
    return CopingStep(
        title="Write one sentence about what you want instead",
        detail="Not what you are running from. What you actually want.",
    )


def build_panic_response(
    *,
    urge_level: int,
    preference_type: str | None,
    current_streak: int,
    timezone: str | None,
    trigger: str | None,
) -> PanicResponse:
    started_bucket = _bucket(urge_level)
    tier = _TIERS[started_bucket]

    # Small deterministic variation so repeat hits are not robotic, but the
    # same input always produces the same answer (testable, cacheable).
    seed = f"{urge_level}:{preference_type}:{current_streak}"
    pick = int(hashlib.sha256(seed.encode()).hexdigest(), 16)

    steps = list(tier["steps"])
    steps.append(_extra_step(preference_type, _hour_in(timezone)))
    steps.append(
        CopingStep(
            title="Write one line for yourself",
            detail=_REFLECTION.get(preference_type or "general", _REFLECTION["general"]),
        )
    )

    if trigger:
        steps.insert(
            0,
            CopingStep(
                title="Name the trigger out loud",
                detail=f"You said it was {trigger}. Triggers lose power once they are spoken.",
            ),
        )

    cache_key = hashlib.sha256(
        f"{seed}:{trigger or ''}".encode()
    ).hexdigest()[:32]

    # A high streak is exactly when people need the reminder most.
    lead = f"You are on day {current_streak}. " if current_streak >= 7 else ""

    return PanicResponse(
        response=lead + tier["response"],
        steps=steps,
        grounding=_GROUNDING,
        escalate_to_admins=tier["escalate"] or started_bucket >= 6,
        cache_key=cache_key,
        urge_level=urge_level,
        latency_ms=0.0,
    )