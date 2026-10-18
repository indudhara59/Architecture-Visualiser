from __future__ import annotations
from dataclasses import dataclass
class User: pass
import typing
if typing.TYPE_CHECKING:
    from ..services.billing import charge
