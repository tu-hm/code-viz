import threading

results = []


def work(k):
    total = 0
    for i in range(k):
        total += i
    results.append(total)


t = threading.Thread(target=work, args=(3,))
t.start()
t.join()
work(2)
print(results)
