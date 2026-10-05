"""Shared cache used by the model-backed moderation paths."""

from __future__ import annotations

from collections import OrderedDict


class BoundedCache:
    """Tiny LRU so repeated messages skip the network entirely."""

    def __init__(self, capacity: int = 2048) -> None:
        self._data: OrderedDict[str, dict] = OrderedDict()
        self._capacity = capacity

    def get(self, key: str) -> dict | None:
        if key not in self._data:
            return None
        self._data.move_to_end(key)
        return self._data[key]

    def set(self, key: str, value: dict) -> None:
        self._data[key] = value
        self._data.move_to_end(key)
        while len(self._data) > self._capacity:
            self._data.popitem(last=False)

    def clear(self) -> None:
        self._data.clear()
