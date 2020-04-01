import * as Knex from 'knex';
import { PlaybookRunSystem, Status, PlaybookRunExecutor, PlaybookRun } from '../handlers/receptor/models';
import { trim } from './utils';

const NON_FINAL_STATES_SYSTEMS = [Status.PENDING, Status.RUNNING];
const NON_FINAL_STATES_EXECUTORS = [Status.PENDING, Status.ACKED, Status.RUNNING];
const FINAL_STATES = [Status.SUCCESS, Status.FAILURE, Status.CANCELED];

const EXECUTOR_FINAL_STATUS_SUBQUERY = trim`
    (
        SELECT "status" FROM (
            SELECT
                "status"::VARCHAR,
                (
                    CASE
                        WHEN "status" = 'failure' THEN 2
                        WHEN "status" = 'canceled' THEN 1
                        ELSE 0
                    END
                ) as "result"
            FROM "playbook_run_systems"
            WHERE "playbook_run_systems"."playbook_run_executor_id" = "playbook_run_executors"."id"
            ORDER BY "result" DESC
            LIMIT 1
        ) as "status"
    )::enum_playbook_run_executors_status`;

const RUN_FINAL_STATUS_SUBQUERY = trim`
    (
        SELECT "status" FROM (
            SELECT
                "executors"."status"::VARCHAR,
                (
                    CASE
                        WHEN "executors"."status" = 'failure' THEN 2
                        WHEN "executors"."status" = 'canceled' THEN 1
                        ELSE 0
                    END
                ) as "result"
            FROM "playbook_run_executors" AS "executors"
            WHERE "playbook_runs"."id" = "executors"."playbook_run_id"
            ORDER BY "result" DESC
            LIMIT 1
        ) as "status"
    )::enum_playbook_runs_status`;

export function cancelSystems (knex: Knex, timeoutMinutes = 3 * 60) {
    return knex(PlaybookRunSystem.TABLE)
    .whereNotIn(PlaybookRunSystem.status, FINAL_STATES)
    .whereRaw(`updated_at < now() - ? * interval '1 minute'`, [timeoutMinutes])
    .update({
        [PlaybookRunSystem.status]: Status.CANCELED
    });
}

export function cancelExecutors (knex: Knex, timeoutMinutes = 15) {
    return knex(PlaybookRunExecutor.TABLE)
    .whereNotIn(PlaybookRunExecutor.status, FINAL_STATES)
    .whereNotExists(
        knex(PlaybookRunSystem.TABLE)
        .whereIn(PlaybookRunSystem.status, NON_FINAL_STATES_SYSTEMS)
        .where(PlaybookRunSystem.playbook_run_executor_id, knex.raw('"playbook_run_executors"."id"'))
    )
    .whereRaw(`updated_at < now() - ? * interval '1 minute'`, [timeoutMinutes])
    .update(PlaybookRunExecutor.status, knex.raw(EXECUTOR_FINAL_STATUS_SUBQUERY));
}

export function cancelRuns (knex: Knex, timeoutMinutes = 15) {
    return knex(PlaybookRun.TABLE)
    .whereNotIn(PlaybookRun.status, FINAL_STATES)
    .whereRaw(`updated_at < now() - ? * interval '1 minute'`, [timeoutMinutes])
    .whereNotExists(
        knex(PlaybookRunExecutor.TABLE)
        .whereIn(PlaybookRunExecutor.status, NON_FINAL_STATES_EXECUTORS)
        .where(PlaybookRunExecutor.playbook_run_id, knex.raw('"playbook_runs"."id"'))
    )
    .update(PlaybookRun.status, knex.raw(RUN_FINAL_STATUS_SUBQUERY));
}