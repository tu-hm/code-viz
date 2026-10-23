def main():
    n = 3_000_000
    a = [0] * n
    for i in range(n): a[i] = i % 7
    big = [x for x in a if x > 3]
    total = sum(x * 2 for x in big)
    print(total)


main()
