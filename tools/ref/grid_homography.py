import numpy as np, json
from PIL import Image
im=np.asarray(Image.open('10.jpg').convert('RGB')).astype(int)
r,g,b=im[...,0],im[...,1],im[...,2]
m=(g>110)&(g-r>45)&(g-b>10)
def peaks(a,thr,sep=40):
    out=[]
    for i in range(1,len(a)-1):
        if a[i]>=thr and a[i]>=a[i-1] and a[i]>=a[i+1]:
            if out and i-out[-1][0]<sep:
                if a[i]>out[-1][1]: out[-1]=(i,int(a[i]))
            else: out.append((i,int(a[i])))
    return [p[0] for p in out]
# vertical lines (panel x = 100*k): k from the position in the y=880 strip (211 -> k=1, ~98.3 px per line)
vs={}
for y0 in (560,700,880,1130):
    for x in peaks(m[y0:y0+16].sum(0),8):
        k=round((x-211)/98.3)+1
        vs.setdefault(k,[]).append((y0+8,x))
hs={}
for x0 in (130,420,1000,1650,1930):
    for y in peaks(m[:,x0:x0+16].sum(1),8):
        j=round((y-598)/96.2)+1       # y=598 -> j=1 (panel y 100); 694 -> 2
        hs.setdefault(j,[]).append((x0+8,y))
# intersections of fitted lines
pts=[]
for k,v in vs.items():
    if len(v)<2 or not 1<=k<=19: continue
    ya=np.array([p[0] for p in v]);xa=np.array([p[1] for p in v]); A=np.polyfit(ya,xa,1)   # x = A0*y + A1
    for j,h in hs.items():
        if len(h)<3 or not 1<=j<=7: continue
        xb=np.array([p[0] for p in h]);yb=np.array([p[1] for p in h]); B=np.polyfit(xb,yb,1) # y = B0*x + B1
        # solve x=A0*y+A1, y=B0*x+B1
        x=(A[0]*B[1]+A[1])/(1-A[0]*B[0]); y=B[0]*x+B[1]
        pts.append((100*k,100*j,x,y))
print('intersections',len(pts))
P=np.array(pts)
# homography panel->photo by DLT
def dlt(src,dst):
    A=[]
    for (X,Y),(x,y) in zip(src,dst):
        A.append([X,Y,1,0,0,0,-x*X,-x*Y,-x]); A.append([0,0,0,X,Y,1,-y*X,-y*Y,-y])
    _,_,V=np.linalg.svd(np.array(A)); return V[-1].reshape(3,3)/V[-1][-1]
Hm=dlt(P[:,:2],P[:,2:])
def ap(Hm,p):
    v=Hm@np.array([p[0],p[1],1.0]); return v[:2]/v[2]
err=[np.linalg.norm(ap(Hm,p[:2])-p[2:]) for p in P]
print('fit residual px: mean %.1f max %.1f'%(np.mean(err),np.max(err)))
Hi=np.linalg.inv(Hm)
json.dump({'Hm':Hm.tolist(),'Hi':Hi.tolist()},open('../scratchpad/H.json','w'))
def to_panel(x,y): return ap(Hi,(x,y))
print('scale: panel 100 px = photo %.1f px (x), %.1f px (y)'%(np.linalg.norm(ap(Hm,(1000,400))-ap(Hm,(900,400))),np.linalg.norm(ap(Hm,(1000,400))-ap(Hm,(1000,300)))))
# visible region from the green extents
ys,xs=np.nonzero(m)
print('green extents photo x %d..%d y %d..%d'%(xs.min(),xs.max(),ys.min(),ys.max()))
for name,(x,y) in {'photo top-mid-left':(620,515),'photo top mid':(1000,515)}.items(): print(name,to_panel(x,y).round(0))
