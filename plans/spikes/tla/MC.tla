--------------------------------- MODULE MC ---------------------------------
EXTENDS JobQueue, TLC

Symmetry == Permutations(Keys) \cup Permutations(Vizs) \cup Permutations(Procs)
=============================================================================
