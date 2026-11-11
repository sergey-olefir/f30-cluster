import cv2, numpy as np, json, sys
sys.path.insert(0,'/Users/solefir/projects/f30-cluster/bake/work/C3'); 
exec(open('/Users/solefir/projects/f30-cluster/bake/src/C3/measure/measure.py').read().split('np.set_printoptions')[0])
np.set_printoptions(linewidth=220,precision=3,suppress=True)
for base,c,flip in [('17_physical-cluster_full.comfort.C3@2x',(80,628),0),('04_comfort_whole-cluster_mph.comfort.C3',(80,628),0),('07_physical-cluster_all-lamps-lit.comfort.C3',(80,628),0),('17_physical-cluster_full.comfort.C4',(1840,628),1),('04_comfort_whole-cluster_mph.comfort.C4',(1840,628),1),('07_physical-cluster_all-lamps-lit.comfort.C4',(1840,628),1)]:
    A,r,u=unwrap(base,*c)
    if flip: u=u[:,::-1][:, np.r_[len(A)-1, 0:len(A)-1]]
    L=u.mean(2); print('==',base)
    # major tick radial profile at 199.5,247.7,296.8 (mean)
    for ang,nm in [((198,201),'maj200'),((246,249.5),'maj248'),((295,298.5),'maj297'),((208,210),'min209'),((227,229.5),'min228'),((265.5,268.5),'min267')]:
        s=(A>=ang[0])&(A<=ang[1]); p=L[:,s].max(1); mx=p[(r>0.5)&(r<0.95)].max(); bg=np.median(p[(r>0.3)&(r<0.5)])
        rs=r[(p>bg+0.5*(mx-bg))&(r>0.57)&(r<0.95)]
        print('  ',nm,'r50%%: %.3f-%.3f peak %.0f bg %.0f'%(rs.min(),rs.max(),mx,bg))
    # angular FWHM of minors/majors at r 0.71
    row=L[np.abs(r-0.71)<0.01].mean(0)
    for a0 in (209,218.5,228.3,237.9,199.5,247.7,296.8):
        s=(A>a0-6)&(A<a0+6); p=row[s]; aa=A[s]; bg=np.percentile(row[(A>205)&(A<245)],20); mx=p.max()
        on=aa[p>bg+0.5*(mx-bg)]; print('   ang %.1f fwhm %.2f deg -> %.2f px  centre %.2f'%(a0,on.max()-on.min()+0.25,(on.max()-on.min()+0.25)*np.pi/180*0.71*70,(on.max()+on.min())/2))
    # inner arc angular profile at r~0.55
    rr=(r>0.52)&(r<0.58); prof=L[rr].max(0); bg=np.median(L[(r>0.35)&(r<0.45)])
    print('  inner arc bg',bg,' val by 10deg:',[int(prof[(A>=a)&(A<a+10)].mean()) for a in range(140,360,10)])
    # radial profile of inner arc at 240-290
    s=(A>255)&(A<285); p=np.median(L[:,s],1); 
    print('  radial prof 0.45..0.65:', [(round(r[i],3),int(p[i])) for i in range(len(r)) if 0.48<r[i]<0.62][::2])
    s=(A>60)&(A<120)|(A>200)&(A<205); 
    s=(A>178)&(A<186) if False else (A>335)&(A<340)
    p=np.median(L[:, (A>225)&(A<235)],1)
    print('  bezel radial prof 0.88..1.06 @225-235:', [(round(r[i],3),int(p[i])) for i in range(len(r)) if 0.85<r[i]<1.06][::2])
    # bezel angular coverage at r 0.95-1.0
    bz=L[(r>0.94)&(r<1.02)].max(0); print('  bezel by 15deg:',[int(bz[(A>=a)&(A<a+15)].mean()) for a in range(0,360,15)])
