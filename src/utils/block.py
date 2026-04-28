from __future__ import annotations
from dataclasses import dataclass
from enum import IntEnum


class Orientation(IntEnum):
    STAND = 0
    FLAT_V = 1  # long axis N-S; anchor = northernmost cell
    FLAT_H = 2  # long axis E-W; anchor = westernmost cell


class Action(IntEnum):
    N = 0
    E = 1
    S = 2
    W = 3


@dataclass(frozen=True)
class BlockState:
    r: int
    c: int
    orientation: Orientation

    def cells(self) -> list[tuple[int, int]]:
        if self.orientation == Orientation.STAND:
            return [(self.r, self.c)]
        if self.orientation == Orientation.FLAT_V:
            return [(self.r, self.c), (self.r + 1, self.c)]
        return [(self.r, self.c), (self.r, self.c + 1)]

    def step(self, action: Action) -> BlockState:
        r, c, o = self.r, self.c, self.orientation
        S, V, H = Orientation.STAND, Orientation.FLAT_V, Orientation.FLAT_H

        if o == S:
            if action == Action.N: return BlockState(r - 2, c, V)
            if action == Action.S: return BlockState(r + 1, c, V)
            if action == Action.W: return BlockState(r, c - 2, H)
            return BlockState(r, c + 1, H)

        if o == V:
            if action == Action.N: return BlockState(r - 1, c, S)
            if action == Action.S: return BlockState(r + 2, c, S)
            if action == Action.W: return BlockState(r, c - 1, V)
            return BlockState(r, c + 1, V)

        # FLAT_H
        if action == Action.N: return BlockState(r - 1, c, H)
        if action == Action.S: return BlockState(r + 1, c, H)
        if action == Action.W: return BlockState(r, c - 1, S)
        return BlockState(r, c + 2, S)
