def main():
    n = 6_000_000
    total = 0
    seen = [0] * 1000
    for i in range(n):
        if i % 3 == 0:
            total += i
        seen[i % 1000] += 1
    print(total, seen[7])


main()
