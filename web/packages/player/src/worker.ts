import { expose } from 'comlink'
import { createWorkerApi } from './worker-api.ts'

expose(createWorkerApi())
