import functools


def deco(fn):
    @functools.wraps(fn)
    def wrapper(*args):
        return fn(*args)
    return wrapper


@deco
def add(a,
        b=2):
    total = a + b
    return total


square = lambda x: x * x
values = [add(1), square(3)]
gen_total = sum(v for v in values)
print(values, gen_total)
