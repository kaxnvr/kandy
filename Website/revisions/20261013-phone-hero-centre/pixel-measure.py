from PIL import Image
import json
from collections import deque
states=[]
for w,h in [(390,700),(390,844),(375,667),(430,932),(320,568)]:
 row={'size':[w,h]}
 for name,prefix in [('before','paired-before'),('after','final')]:
  im=Image.open(f'/tmp/kandy-{prefix}-{w}x{h}.png').convert('RGB');pix=im.load()
  points={(x,y) for y in range(90,min(h,650)) for x in range(w) if (lambda r,g,b:r>180 and b>100 and r-g>30 and r-b>5)(*pix[x,y])}
  groups=[]
  while points:
   q=deque([points.pop()]);group=[]
   while q:
    x,y=q.popleft();group.append((x,y))
    for v in [(x-1,y),(x+1,y),(x,y-1),(x,y+1)]:
     if v in points:points.remove(v);q.append(v)
   if len(group)>500:groups.extend(group)
  x=[p[0] for p in groups];y=[p[1] for p in groups];bounds=[min(x),min(y),max(x)+1,max(y)+1]
  row[name]={'bounds':bounds,'width':bounds[2]-bounds[0],'centreY':(bounds[1]+bounds[3])/2,'pixels':len(groups)}
 row['shift']=row['after']['centreY']-row['before']['centreY'];row['distanceFromScreenCentre']=row['after']['centreY']-h/2;states.append(row)
print(json.dumps(states,indent=2));open('/tmp/kandy-pixel-measure.json','w').write(json.dumps(states,indent=2))
