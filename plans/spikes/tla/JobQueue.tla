------------------------------ MODULE JobQueue ------------------------------
(***************************************************************************)
(* The MySQL job queue of backend/internal/adapters/mysql (queue.go,       *)
(* store.go) and the worker of backend/internal/app/worker.go, at commit   *)
(* 26837b8. Spec: §7.7, §7.8, §7.12, §7.13.2.                              *)
(*                                                                         *)
(* Each MySQL transaction is one atomic step. That is sound here: every    *)
(* transaction that writes a trace or its job first locks the trace row    *)
(* (FOR UPDATE), except Claim, which locks only the job row with SKIP      *)
(* LOCKED and never writes the trace. Cancel's UPDATE re-reads the job's   *)
(* status after Claim's lock is released (READ COMMITTED).                 *)
(*                                                                         *)
(* A trace is identified by its cache key: INSERT ... ON DUPLICATE KEY on  *)
(* the unique cache_key gives one row per key, and a reset reuses its id,  *)
(* so its chunk keys too. Chunks are one blob per trace here, tagged with  *)
(* the run (job, attempt) that uploaded them.                              *)
(*                                                                         *)
(* Time is abstract. Expire(i) is the moment job i's lease runs out by the *)
(* rescuer's clock. With perfect clocks that is also the worker's ctx      *)
(* deadline (both are claimed + 45 s), so the holder turns late at once.   *)
(* With LateWrites the holder learns of it later: a skewed clock, or a     *)
(* PUT already in flight that lands after the deadline.                    *)
(***************************************************************************)
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS
    Keys,         \* cache keys
    Vizs,         \* visualization ids; each is created at most once
    Procs,        \* worker processes
    MaxAttempts,  \* 2: infra errors are retried once (§7.7)
    MaxCrashes,   \* worker processes that die for good
    SharedName,   \* TRUE: every process leases as "host" (no random suffix in workerName)
    LateWrites    \* TRUE: a worker's writes can land after its lease expired

VARIABLES
    trace,    \* trace[k]: the traces row of cache key k
    jobs,     \* jobs[i]: the jobs rows, in insert order
    viz,      \* viz[v]: the visualizations row
    blob,     \* blob[k]: the run whose chunks object storage holds for k
    proc,     \* proc[p]: what worker process p is doing
    crashes

vars == <<trace, jobs, viz, blob, proc, crashes>>

None == "none"
NoRun == <<0, 0>>
LiveJob == {"queued", "running"}
FinalJob == {"done", "failed", "canceled"}
Unfinished == {"queued", "building", "tracing"}
Finished == {"completed", "failed", "canceled"}
MaxJobs == Cardinality(Vizs)
Runs == (1..MaxJobs) \X (1..MaxAttempts)

Name(p) == IF SharedName THEN "host" ELSE p

Idle == [state |-> "idle", job |-> 0, att |-> 0, stage |-> "", late |-> FALSE, overdue |-> FALSE]

TypeOK ==
    /\ trace \in [Keys -> [status: {"absent"} \cup Unfinished \cup Finished,
                           failure: {"", "infra", "user"},
                           chunks: Runs \cup {NoRun}]]
    /\ Len(jobs) <= MaxJobs
    /\ \A i \in DOMAIN jobs : jobs[i] \in [key: Keys, status: LiveJob \cup FinalJob, attempt: 0..MaxAttempts,
                                         leasedBy: {Name(p) : p \in Procs} \cup {None}, expired: BOOLEAN]
    /\ viz \in [Vizs -> [state: {"absent", "attached", "detached"}, key: Keys \cup {None}]]
    /\ blob \in [Keys -> Runs \cup {NoRun}]
    /\ proc \in [Procs -> [state: {"idle", "busy", "dead"}, job: 0..MaxJobs, att: 0..MaxAttempts,
                           stage: {"", "claimed", "building", "tracing", "upload", "uploaded"},
                           late: BOOLEAN, overdue: BOOLEAN]]
    /\ crashes \in 0..MaxCrashes

Init ==
    /\ trace = [k \in Keys |-> [status |-> "absent", failure |-> "", chunks |-> NoRun]]
    /\ jobs = <<>>
    /\ viz = [v \in Vizs |-> [state |-> "absent", key |-> None]]
    /\ blob = [k \in Keys |-> NoRun]
    /\ proc = [p \in Procs |-> Idle]
    /\ crashes = 0

-----------------------------------------------------------------------------
(* Queue writes shared by the worker and the rescuer (queue.go)            *)

FailJob(i, kind) ==
    /\ trace' = [trace EXCEPT ![jobs[i].key].status = "failed", ![jobs[i].key].failure = kind]
    /\ jobs' = [jobs EXCEPT ![i].status = "failed"]

\* release: requeue after an infra error, or fail with internal_error after the last attempt
Release(i) ==
    IF jobs[i].attempt >= MaxAttempts
    THEN FailJob(i, "infra")
    ELSE /\ trace' = [trace EXCEPT ![jobs[i].key].status = "queued"]
         /\ jobs' = [jobs EXCEPT ![i].status = "queued"]

-----------------------------------------------------------------------------
(* API: Store.Create and Store.Detach (store.go)                           *)

Rerun(k) == \/ trace[k].status = "canceled"
            \/ trace[k].status = "failed" /\ trace[k].failure = "infra"

Create(v, k) ==
    /\ viz[v].state = "absent"
    /\ viz' = [viz EXCEPT ![v] = [state |-> "attached", key |-> k]]
    /\ IF trace[k].status = "absent" \/ Rerun(k)
       THEN /\ trace' = [trace EXCEPT ![k] = [status |-> "queued", failure |-> "", chunks |-> NoRun]]
            /\ jobs' = Append(jobs, [key |-> k, status |-> "queued", attempt |-> 0, leasedBy |-> None, expired |-> FALSE])
       ELSE UNCHANGED <<trace, jobs>>
    /\ UNCHANGED <<blob, proc, crashes>>

\* also the bump of the oldest queued visualization inside Create: same detach, same trace lock
Detach(v) ==
    /\ viz[v].state = "attached"
    /\ viz' = [viz EXCEPT ![v].state = "detached"]
    /\ LET k == viz[v].key
           waiting == {u \in Vizs \ {v} : viz[u].state = "attached" /\ viz[u].key = k}
           queued == {i \in DOMAIN jobs : jobs[i].key = k /\ jobs[i].status = "queued"}
       IN IF waiting = {} /\ queued # {}
          THEN /\ jobs' = [i \in DOMAIN jobs |-> IF i \in queued THEN [jobs[i] EXCEPT !.status = "canceled"] ELSE jobs[i]]
               /\ trace' = [trace EXCEPT ![k].status = "canceled"]
          ELSE UNCHANGED <<trace, jobs>>
    /\ UNCHANGED <<blob, proc, crashes>>

-----------------------------------------------------------------------------
(* Worker (worker.go): claim, then building, tracing, upload, complete      *)

Job(p) == proc[p].job
Key(p) == jobs[Job(p)].key
Run(p) == <<Job(p), proc[p].att>>

\* LockLeasedJob: id = ? AND leased_by = ? AND status = 'running'
Fence(p) == jobs[Job(p)].leasedBy = Name(p) /\ jobs[Job(p)].status = "running"

Step(p, s) == IF s = "idle" THEN proc' = [proc EXCEPT ![p] = Idle] ELSE proc' = [proc EXCEPT ![p].stage = s]

\* queue.leased: a lost lease returns ErrLeaseLost, writes nothing, and ends the run
Leased(p, write, s) ==
    IF Fence(p)
    THEN write /\ Step(p, s)
    ELSE /\ proc' = [proc EXCEPT ![p] = Idle]
         /\ UNCHANGED <<trace, jobs>>

At(p, s) == proc[p].state = "busy" /\ proc[p].stage = s /\ ~proc[p].late

Claim(p) ==
    /\ proc[p].state = "idle"
    /\ \E i \in DOMAIN jobs :
        /\ jobs[i].status = "queued"
        /\ jobs' = [jobs EXCEPT ![i].status = "running", ![i].attempt = @ + 1, ![i].leasedBy = Name(p), ![i].expired = FALSE]
        /\ proc' = [proc EXCEPT ![p] = [state |-> "busy", job |-> i, att |-> jobs[i].attempt + 1,
                                        stage |-> "claimed", late |-> FALSE, overdue |-> FALSE]]
    /\ UNCHANGED <<trace, viz, blob, crashes>>

MarkBuilding(p) ==
    /\ At(p, "claimed")
    /\ Leased(p, trace' = [trace EXCEPT ![Key(p)].status = "building"] /\ UNCHANGED jobs, "building")
    /\ UNCHANGED <<viz, blob, crashes>>

BuildFails(p) ==
    /\ At(p, "building")
    /\ Leased(p, FailJob(Job(p), "user"), "idle")
    /\ UNCHANGED <<viz, blob, crashes>>

MarkTracing(p) ==
    /\ At(p, "building")
    /\ Leased(p, trace' = [trace EXCEPT ![Key(p)].status = "tracing"] /\ UNCHANGED jobs, "tracing")
    /\ UNCHANGED <<viz, blob, crashes>>

SandboxRuns(p) ==
    /\ At(p, "tracing")
    /\ Step(p, "upload")
    /\ UNCHANGED <<trace, jobs, viz, blob, crashes>>

\* sandbox failed to start, or the node drained: requeue
SandboxFails(p) ==
    /\ At(p, "tracing")
    /\ Leased(p, Release(Job(p)), "idle")
    /\ UNCHANGED <<viz, blob, crashes>>

\* tracecore.ErrMalformed: fail with internal_error
TracerMalformed(p) ==
    /\ At(p, "tracing")
    /\ Leased(p, FailJob(Job(p), "infra"), "idle")
    /\ UNCHANGED <<viz, blob, crashes>>

\* Blobs.Put has no lease check
Upload(p) ==
    /\ proc[p].state = "busy" /\ proc[p].stage = "upload" /\ ~proc[p].late
    /\ blob' = [blob EXCEPT ![Key(p)] = Run(p)]
    /\ Step(p, "uploaded")
    /\ UNCHANGED <<trace, jobs, viz, crashes>>

StorageFails(p) ==
    /\ At(p, "upload")
    /\ Leased(p, Release(Job(p)), "idle")
    /\ UNCHANGED <<viz, blob, crashes>>

Complete(p) ==
    /\ At(p, "uploaded")
    /\ Leased(p, /\ trace' = [trace EXCEPT ![Key(p)].status = "completed", ![Key(p)].chunks = Run(p)]
                 /\ jobs' = [jobs EXCEPT ![Job(p)].status = "done"],
              "idle")
    /\ UNCHANGED <<viz, blob, crashes>>

\* the job's ctx hit claimed + 45 s: run() requeues under context.WithoutCancel
GiveUp(p) ==
    /\ proc[p].state = "busy" /\ proc[p].late
    /\ Leased(p, Release(Job(p)), "idle")
    /\ UNCHANGED <<viz, blob, crashes>>

\* watch: CheckLease every second cancels the run once the lease is gone
NoticeLostLease(p) ==
    /\ proc[p].state = "busy" /\ ~Fence(p)
    /\ proc' = [proc EXCEPT ![p] = Idle]
    /\ UNCHANGED <<trace, jobs, viz, blob, crashes>>

\* LateWrites: the worker's own deadline comes after the rescuer saw the lease expire
Deadline(p) ==
    /\ proc[p].state = "busy" /\ proc[p].overdue /\ ~proc[p].late
    /\ proc' = [proc EXCEPT ![p].late = TRUE]
    /\ UNCHANGED <<trace, jobs, viz, blob, crashes>>

Crash(p) ==
    /\ proc[p].state # "dead"
    /\ crashes < MaxCrashes
    /\ \E q \in Procs \ {p} : proc[q].state # "dead"
    /\ proc' = [proc EXCEPT ![p] = [Idle EXCEPT !.state = "dead"]]
    /\ crashes' = crashes + 1
    /\ UNCHANGED <<trace, jobs, viz, blob>>

-----------------------------------------------------------------------------
(* Lease expiry and the rescuer (Queue.Rescue)                              *)

Holds(p, i) == proc[p].state = "busy" /\ proc[p].job = i /\ proc[p].att = jobs[i].attempt

Expire(i) ==
    /\ i \in DOMAIN jobs
    /\ jobs[i].status = "running" /\ ~jobs[i].expired
    /\ jobs' = [jobs EXCEPT ![i].expired = TRUE]
    /\ proc' = [p \in Procs |-> IF ~Holds(p, i) THEN proc[p]
                                ELSE IF LateWrites THEN [proc[p] EXCEPT !.overdue = TRUE]
                                ELSE [proc[p] EXCEPT !.late = TRUE]]
    /\ UNCHANGED <<trace, viz, blob, crashes>>

\* LockExpiredJob: status = 'running' AND leased_until < now, under the trace lock
Rescue(i) ==
    /\ i \in DOMAIN jobs
    /\ jobs[i].status = "running" /\ jobs[i].expired
    /\ Release(i)
    /\ UNCHANGED <<viz, blob, proc, crashes>>

-----------------------------------------------------------------------------

Work(p) ==
    \/ MarkBuilding(p) \/ BuildFails(p) \/ MarkTracing(p) \/ SandboxRuns(p) \/ SandboxFails(p) \/ TracerMalformed(p)
    \/ Upload(p) \/ StorageFails(p) \/ Complete(p) \/ GiveUp(p) \/ NoticeLostLease(p) \/ Deadline(p)

Next ==
    \/ \E p \in Procs : Claim(p) \/ Work(p) \/ Crash(p)
    \/ \E i \in 1..MaxJobs : Expire(i) \/ Rescue(i)
    \/ \E v \in Vizs, k \in Keys : Create(v, k)
    \/ \E v \in Vizs : Detach(v)

Fairness ==
    /\ \A p \in Procs : WF_vars(Claim(p)) /\ WF_vars(Work(p))
    /\ \A i \in 1..MaxJobs : WF_vars(Expire(i)) /\ WF_vars(Rescue(i))

Spec == Init /\ [][Next]_vars
LiveSpec == Spec /\ Fairness

-----------------------------------------------------------------------------
(* Safety                                                                   *)

\* §7.13.2: never more than one live job per trace
OneLiveJobPerTrace ==
    \A k \in Keys : Cardinality({i \in DOMAIN jobs : jobs[i].key = k /\ jobs[i].status \in LiveJob}) <= 1

\* a job status change and its trace's commit together (JobQueue port)
TraceMatchesJob ==
    \A k \in Keys :
        /\ trace[k].status \in Unfinished <=> \E i \in DOMAIN jobs : jobs[i].key = k /\ jobs[i].status \in LiveJob
        /\ trace[k].status \in {"building", "tracing"} => \E i \in DOMAIN jobs : jobs[i].key = k /\ jobs[i].status = "running"

\* §7.7: a job runs at most twice
AttemptsBounded == \A i \in DOMAIN jobs : jobs[i].attempt <= MaxAttempts

\* §7.7: a job is canceled only when no visualization waits for it
AttachedNeverCanceled == \A v \in Vizs : viz[v].state = "attached" => trace[viz[v].key].status # "canceled"

\* the lease fence: only the run holding the job's current lease can complete it
CompletedByCurrentLease ==
    \A k \in Keys : trace[k].status = "completed" =>
        \E i \in DOMAIN jobs : /\ jobs[i].key = k /\ jobs[i].status = "done"
                               /\ trace[k].chunks = <<i, jobs[i].attempt>>

\* the chunks the API signs are the ones the completed row describes (sha256, sizeBytes)
ChunksMatchTrace == \A k \in Keys : trace[k].status = "completed" => blob[k] = trace[k].chunks

-----------------------------------------------------------------------------
(* Liveness, under Fairness                                                 *)

\* no job is lost: every queued or running job ends
JobsEnd == \A i \in 1..MaxJobs : (i \in DOMAIN jobs /\ jobs[i].status \in LiveJob) ~> (i \in DOMAIN jobs /\ jobs[i].status \in FinalJob)

\* every attached visualization reaches a final status, or its owner detaches it
VisualizationsSettle ==
    \A v \in Vizs : (viz[v].state = "attached")
                   ~> (viz[v].state = "detached" \/ (viz[v].state = "attached" /\ trace[viz[v].key].status \in Finished))
=============================================================================
