from fractions import Fraction


def inner(x):
    y = x * 2
    raise ValueError("bad " + str(y))


def middle(x):
    return inner(x) + 1


def outer():
    try:
        middle(5)
    except ValueError as e:
        msg = str(e)
    try:
        Fraction(1, 0)
    except ZeroDivisionError:
        msg = "zero"
    try:
        int("x")
    except ValueError:
        try:
            raise
        except ValueError:
            pass
    return msg


outer()
d = {}
d["missing"]
print("not reached")
