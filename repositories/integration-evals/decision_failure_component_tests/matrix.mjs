export const matrix = [
  {id:'complete-control',status:'complete',usage:'complete',send:1},
  {id:'timeout-before-send',status:'timeout',usage:'unknown',send:0,clockOffset:6000},
  {id:'cancel-before-send',status:'cancelled',usage:'unknown',send:0},
  {id:'timeout-after-send',status:'timeout',usage:'unknown',send:1,deadlineOffset:500},
  {id:'cancel-after-send',status:'cancelled',usage:'unknown',send:1},
  {id:'http-429',status:'unavailable',usage:'unknown',send:1,httpStatus:429},
  {id:'http-503',status:'unavailable',usage:'unknown',send:1,httpStatus:503},
  {id:'malformed-json',status:'unavailable',usage:'unknown',send:1},
  {id:'truncated-json',status:'unavailable',usage:'unknown',send:1},
  {id:'wrong-question-keys',status:'unavailable',usage:'complete',send:1},
  {id:'invalid-score',status:'unavailable',usage:'complete',send:1},
  {id:'invalid-distribution',status:'unavailable',usage:'complete',send:1},
  {id:'missing-usage',status:'unavailable',usage:'unknown',send:1},
  {id:'uncertain-noul',status:'review',usage:'complete',send:1},
  {id:'low-score-confidence',status:'review',usage:'complete',send:1},
];
export const remaining = [
  {id:'choice-complete-control',kind:'choice',status:'complete'},
  {id:'choice-unknown-option',kind:'choice',status:'unavailable'},
  {id:'choice-invalid-enum',kind:'choice',status:'unavailable'},
  {id:'raw-nan',status:'unavailable',usage:'unknown',send:1},
  {id:'numeric-overflow',status:'unavailable',usage:'unknown',send:1},
  {id:'missing-provider-reference',status:'complete',usage:'complete',send:1},
  {id:'late-response-timeout',status:'timeout',usage:'unknown',send:1,deadlineOffset:500},
  {id:'late-response-cancel',status:'cancelled',usage:'unknown',send:1},
  {id:'late-permit-cancel',status:'cancelled',usage:'unknown',send:0,counters:{dns:1,requests:1,writes:0},callbacks:['revalidate']},
];
export const allCases=[...matrix,...remaining];
export function faultFor(descriptor, body, controller) {
  switch(descriptor.id) {
    case 'cancel-before-send': controller.abort(); return {body};
    case 'timeout-after-send': return {body,afterWrite:()=>{}};
    case 'cancel-after-send': return {body,afterWrite:()=>controller.abort()};
    case 'raw-nan': return {body:JSON.stringify(body).replace('\"score\":3.2','\"score\":NaN')};
    case 'numeric-overflow': return {body:JSON.stringify(body).replace('\"score\":3.2','\"score\":1e309')};
    case 'missing-provider-reference': case 'late-response-timeout': case 'late-response-cancel': case 'late-permit-cancel': return {body};
    case 'malformed-json': return {body:'not-json'};
    case 'truncated-json': return {body:JSON.stringify(body).slice(0,-8)};
    case 'wrong-question-keys': {const copy=structuredClone(body);copy.answers.wrong=copy.answers.visual_quality;delete copy.answers.visual_quality;return {body:copy};}
    case 'invalid-score': {const copy=structuredClone(body);copy.answers.visual_quality.score=99;return {body:copy};}
    case 'invalid-distribution': {const copy=structuredClone(body);copy.answers.visual_quality.probabilities['3']=1;return {body:copy};}
    case 'missing-usage': {const copy=structuredClone(body);delete copy.usage;return {body:copy};}
    case 'uncertain-noul': {const copy=structuredClone(body);copy.answers.defect_present.noul=0.5;return {body:copy};}
    case 'low-score-confidence': {const copy=structuredClone(body);copy.answers.visual_quality.confidence=0.1;return {body:copy};}
    case 'http-429': case 'http-503': return {body,status:descriptor.httpStatus};
    case 'complete-control': case 'timeout-before-send': return {body};
    default: throw new Error('Unknown evaluator scenario');
  }
}
