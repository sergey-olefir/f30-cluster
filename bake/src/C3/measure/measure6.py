import cv2, numpy as np, json
exec(open('/Users/solefir/projects/f30-cluster/bake/src/C3/measure/measure.py').read().split('np.set_printoptions')[0])
import sys
DX=float(sys.argv[1]); DY=float(sys.argv[2])
for base,c,flip in [('17_physical-cluster_full.comfort.C3@2x',(80,628),0),('04_comfort_whole-cluster_mph.comfort.C3',(80,628),0),('07_physical-cluster_all-lamps-lit.comfort.C3',(80,628),0),('17_physical-cluster_full.comfort.C4',(1840,628),1),('04_comfort_whole-cluster_mph.comfort.C4',(1840,628),1)]:
    cc=(c[0]+(-DX if flip else DX)*70, c[1]+DY*70)
    A,r,u=unwrap(base,*cc,dA=0.25,nr=1060)
    if flip: u=u[:,::-1][:, np.r_[len(A)-1, 0:len(A)-1]]
    L=u.mean(2)
    res=[]
    for a in np.arange(151.15, 346, 9.65):
        s=(A>a-4)&(A<a+4); m=(r>0.5)&(r<0.9)
        sub=L[m][:,s]; col=sub.max(1); bg=np.percentile(col,5); mx=col.max()
        rs=r[m][col>bg+0.5*(mx-bg)]
        ap=sub[(r[m]>0.68)&(r[m]<0.74)].max(0); w=np.clip(ap-np.percentile(ap,30),0,None); w=w*(w>0.5*w.max()); ac=(A[s]*w).sum()/max(w.sum(),1e-6)
        res.append((round(a,1),round(ac,1),round(rs.min(),3),round(rs.max(),3)))
    Lb=cv2.GaussianBlur(L,(0,0),2); m=(r>0.5)&(r<0.62)
    pk=[ (r[m]*np.clip(Lb[m,j]-np.median(Lb[m,j]),0,None)).sum()/max(np.clip(Lb[m,j]-np.median(Lb[m,j]),0,None).sum(),1e-6) for j in np.where((A>200)&(A<330))[0][::40]]
    print(base[:2],base[-4:],'arc r by angle 200..330:',np.round(pk,3))
    print('   ',res)
