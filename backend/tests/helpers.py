from app.models import User
from app.security import hash_pin


def make_user(name: str, phone: str, role: str, pin: str = "1234", must_change: bool = False) -> User:
    u = User(name=name, role=role, pin_hash=hash_pin(pin), must_change_pin=must_change)
    u.set_phone(phone)
    return u
