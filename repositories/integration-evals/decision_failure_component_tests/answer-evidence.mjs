import assert from 'node:assert/strict';

export function validateAnswerEvidence(result,questions) {
  for(const [id,entry] of Object.entries(result.answers)) {
    assert.equal(Object.hasOwn(entry,'confidence'),false);
    assert.equal(Object.hasOwn(entry,'probabilities'),false);
    if(entry.status==='unavailable') {
      assert.deepEqual(Object.keys(entry).sort(),['policy_version','question_schema_version','reason','status']);
    } else if(questions[id]?.type==='noul') {
      assert.equal(entry.answer.type,'noul');
      assert.deepEqual(Object.keys(entry.answer).sort(),['noul','type']);
    }
  }
}
