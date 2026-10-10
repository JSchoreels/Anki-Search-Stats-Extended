"""Exercise the real response helper through Flask's unbuffered WSGI client."""
import importlib.util
import json
from pathlib import Path
from flask import Flask

spec = importlib.util.spec_from_file_location('prediction_pages', Path(__file__).parents[1] / 'prediction_pages.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
app = Flask(__name__)
result = {'column': 'cache', 'data': [(1700000000000+i, (i%100)/100) for i in range(50001)],
          'roles':['test_fold'], 'role_counts':{'test_fold':50001},
          'warnings':['日本語 warning'], 'refresh_after_fsrs':True}
serialized_sizes = []
dumps = module.orjson.dumps
def measured_dumps(value):
    serialized_sizes.append(len(value.get('data', [])))
    return dumps(value)
module.orjson.dumps = measured_dumps
@app.get('/pages')
def pages():
    return module.prediction_response(result, True)
with app.test_client() as client:
    response = client.get('/pages', buffered=False)
    iterator = iter(response.response)
    metadata = json.loads(next(iterator))
    sizes_after_metadata = serialized_sizes.copy()
    remaining = [json.loads(chunk) for chunk in iterator]
    response.close()
legacy = json.loads(module.prediction_response(result).get_data())
empty = [json.loads(chunk) for chunk in module.prediction_response({'column':None,'data':[]}, True).response]
print(json.dumps({'metadata':metadata, 'lazy_sizes':sizes_after_metadata, 'page_sizes':[len(page['data']) for page in remaining[:-1]],
                  'done':remaining[-1], 'reassembled_equal':legacy['data']==[row for page in remaining[:-1] for row in page['data']],
                  'legacy_equal':legacy==json.loads(json.dumps(result)), 'empty':empty}))
