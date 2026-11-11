import cv2, numpy as np, json
Hg=np.array(json.load(open('scratchpad/H.json'))['Hm'])      # panel -> grid photo
Hi=np.linalg.inv(Hg)
g=cv2.imread('images/10.jpg').astype(int)
m=(g[...,1]>110)&(g[...,1]-g[...,2]>10)&(g[...,1]-g[...,0]>45)
def ph2pan(x,y):
    v=Hi@np.array([x,y,1.0]); return v[:2]/v[2]
# hood: the topmost green pixel in each photo column -> panel (x, y)
print('hood (panel x -> first visible panel y):')
pts=[]
for xp in range(100,1901,100):
    # photo column of panel x at panel y=300
    v=Hg@np.array([xp,300,1.0]); xc=int(round(v[0]/v[2]))
    col=m[:, max(0,xc-12):xc+12].any(1)
    ys=np.nonzero(col)[0]
    if len(ys)==0: continue
    y=ys.min(); p=ph2pan(xc,y); pts.append((xp,round(p[1])))
print(pts)
# left / right / bottom: last green pixel rows/cols
ys,xs=np.nonzero(m)
for name,(x,y) in {'left':(xs.min(),700),'right':(xs.max(),700),'bottom':(1000,ys.max())}.items():
    print(name,ph2pan(x,y).round(0))
# zoom the box area of the rectified photo 11
w=cv2.imread('scratchpad/photo11_panel.png')
crop=w[280:500,1360:1640]; crop=cv2.resize(crop,None,fx=3.5,fy=3.5,interpolation=cv2.INTER_CUBIC)
# grid for reading coordinates
for x in range(1360,1641,40):
    cv2.line(crop,(int((x-1360)*3.5),0),(int((x-1360)*3.5),crop.shape[0]),(0,255,255),1); cv2.putText(crop,str(x),(int((x-1360)*3.5)+2,14),0,0.45,(0,255,255),1)
for y in range(280,501,40):
    cv2.line(crop,(0,int((y-280)*3.5)),(crop.shape[1],int((y-280)*3.5)),(0,255,255),1); cv2.putText(crop,str(y),(2,int((y-280)*3.5)-3),0,0.45,(0,255,255),1)
cv2.imwrite('scratchpad/boxzoom.png',crop)
