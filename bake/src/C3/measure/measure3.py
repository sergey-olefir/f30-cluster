import cv2, numpy as np, json
exec(open('/Users/solefir/projects/f30-cluster/bake/src/C3/measure/measure.py').read().split('np.set_printoptions')[0])
for base,c,flip in [('17_physical-cluster_full.comfort.C3@2x',(80,628),0),('04_comfort_whole-cluster_mph.comfort.C3',(80,628),0),('07_physical-cluster_all-lamps-lit.comfort.C3',(80,628),0),('17_physical-cluster_full.comfort.C4',(1840,628),1),('04_comfort_whole-cluster_mph.comfort.C4',(1840,628),1),('07_physical-cluster_all-lamps-lit.comfort.C4',(1840,628),1)]:
    A,r,u=unwrap(base,*c)
    if flip: u=u[:,::-1][:, np.r_[len(A)-1, 0:len(A)-1]]
    b,g,rd=u[...,0],u[...,1],u[...,2]
    for nm,ch in [('red',rd-(g+b)/2),('blue',b-rd)]:
        band=(r>0.5)&(r<0.9); m=ch*band[:,None]
        if m.max()<40: continue
        thr=0.4*m.max(); on=m>thr
        ang=A[on.any(0)]; rr=r[on.any(1)]
        prof=m.max(0); 
        print(base[:6],base[-2:],nm,'max %.0f'%m.max(),'angles %.1f-%.1f'%(ang.min(),ang.max()),'r %.3f-%.3f'%(rr.min(),rr.max()))
        segs=[];s=None
        for j,v in enumerate(prof>thr):
            if v and s is None:s=j
            if not v and s is not None: segs.append((A[s],A[j-1]));s=None
        for s0,s1 in segs:
            sel=(A>=s0)&(A<=s1); col=m[:,sel].max(1); rs=r[col>thr]
            px=u[:,sel][col>0.7*col.max()].reshape(-1,3).mean(0)[::-1]
            print('    seg %.1f-%.1f  r %.3f-%.3f rgb %s'%(s0,s1,rs.min(),rs.max(),px.astype(int)))
