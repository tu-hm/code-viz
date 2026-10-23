from fractions import Fraction


def main():
    total = Fraction(0)
    for i in range(1, 300_001):
        total += Fraction(1, i * (i + 1))
    print(total)


main()
