import cv2, numpy as np, json
from scipy.optimize import least_squares
RECT='/Users/solefir/projects/f30-cluster/bake/work/rect/'
allpts=[]
for base,c,flip in [('17_physical-cluster_full.comfort.C3@2x',(80,628),0),('04_comfort_whole-cluster_mph.comfort.C3',(80,628),0),('07_physical-cluster_all-lamps-lit.comfort.C3',(80,628),0),('17_physical-cluster_full.comfort.C4',(1840,628),1),('04_comfort_whole-cluster_mph.comfort.C4',(1840,628),1),('07_physical-cluster_all-lamps-lit.comfort.C4',(1840,628),1)]:
    im=cv2.imread(RECT+base+'.png').astype(np.float32); m=json.load(open(RECT+base+'.json')); k=im.shape[0]/m['box'][3]
    if k<2: im=cv2.resize(im,None,fx=4/k,fy=4/k,interpolation=cv2.INTER_CUBIC); k=4
    h,w=im.shape[:2]; yy,xx=np.mgrid[0:h,0:w]; X=m['box'][0]+(xx+0.5)/k; Y=m['box'][1]+(yy+0.5)/k
    u=(X-c[0])/70*(-1 if flip else 1); v=(Y-c[1])/70; rad=np.hypot(u,v); ang=(np.degrees(np.arctan2(u,-v))+360)%360
    L=im.mean(2); sat=im.max(2)-im.min(2)
    band=(rad>0.62)&(rad<0.80)&(ang>176)&(ang<333)&(sat<60)
    bg=np.percentile(L[band],30); mx=np.percentile(L[band],99.5)
    bw=((L>bg+0.45*(mx-bg))&band).astype(np.uint8)
    n,lab,st,cen=cv2.connectedComponentsWithStats(bw)
    pts=[]
    for i in range(1,n):
        if st[i,4]<3*k*k/4: continue
        sel=lab==i; wgt=(L[sel]-bg)
        pu=(u[sel]*wgt).sum()/wgt.sum(); pv=(v[sel]*wgt).sum()/wgt.sum()
        pts.append((pu,pv,st[i,4]/(k*k)))
    pts=np.array(pts); a=(np.degrees(np.arctan2(pts[:,0],-pts[:,1]))+360)%360
    o=np.argsort(a); pts=pts[o]; a=a[o]
    print(base[:2],base[-4:],'n',len(pts),np.round(a,1))
    allpts.append(pts)
def resid(p, pts_list):
    cx,cy,a0,pitch=p; out=[]
    for pts in pts_list:
        a=(np.degrees(np.arctan2(pts[:,0]-cx,-(pts[:,1]-cy)))+360)%360
        kk=np.round((a-a0)/pitch); out.append(a-(a0+kk*pitch))
    return np.concatenate(out)
for name,sub in [('all',allpts),('C3',allpts[:3]),('C4',allpts[3:])]:
    best=None
    for p0 in [(0,0,155,9.3),(0.04,0,155,9.3),(0.02,0.02,152,9.6)]:
        r=least_squares(resid,p0,args=(sub,),loss='soft_l1',f_scale=1.0)
        if best is None or r.cost<best.cost: best=r
    print(name,'cx %.4f cy %.4f a0 %.2f pitch %.3f  rms %.2f deg'%(*best.x, np.sqrt(np.mean(best.fun**2))))
    print('   per-source rms:',[round(float(np.sqrt(np.mean(resid(best.x,[s])**2))),2) for s in sub])
    print('   resid first src',np.round(resid(best.x,[sub[0]]),1))
print('--- fixed centre')
def resid2(p, pts_list, cx=0, cy=0):
    a0,pitch=p; out=[]
    for pts in pts_list:
        a=(np.degrees(np.arctan2(pts[:,0]-cx,-(pts[:,1]-cy)))+360)%360
        kk=np.round((a-a0)/pitch); out.append(a-(a0+kk*pitch))
    return np.concatenate(out)
for name,sub in [('C3',[allpts[0],allpts[2]]),('C4',[allpts[3]]),('both',[allpts[0],allpts[2],allpts[3]])]:
    r=least_squares(resid2,(152,9.6),args=(sub,),bounds=([140,9.0],[160,10.2]))
    print(name,'a0 %.2f pitch %.3f rms %.2f'%(*r.x,np.sqrt(np.mean(r.fun**2))))
    for dx in (0.0,0.02,0.045):
        r=least_squares(lambda p: resid2(p,sub,dx,0),(152,9.6),bounds=([140,9.0],[160,10.2]))
        print('   dx',dx,'a0 %.2f pitch %.3f rms %.2f'%(*r.x,np.sqrt(np.mean(r.fun**2))))
