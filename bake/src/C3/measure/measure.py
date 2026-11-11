import cv2, numpy as np, json
R=70.0
RECT='/Users/solefir/projects/f30-cluster/bake/work/rect/'
def unwrap(base, cx, cy, dA=0.25, nr=424):
    im=cv2.imread(RECT+base+'.png').astype(np.float32); m=json.load(open(RECT+base+'.json'))
    x0,y0=m['box'][0],m['box'][1]; k=im.shape[0]/m['box'][3]
    A=np.arange(0,360,dA); r=np.linspace(0,1.06,nr)
    aa,rr=np.meshgrid(A,r); a=np.radians(aa)
    px=((cx+rr*R*np.sin(a))-x0)*k-0.5; py=((cy-rr*R*np.cos(a))-y0)*k-0.5
    u=cv2.remap(im,px.astype(np.float32),py.astype(np.float32),cv2.INTER_LINEAR)
    return A,r,u
np.set_printoptions(linewidth=200,precision=2,suppress=True)
for base,c,flip in [('17_physical-cluster_full.comfort.C3@2x',(80,628),0),('04_comfort_whole-cluster_mph.comfort.C3',(80,628),0),('02_three-modes_clean-render.comfort.C3',(80,628),0),('07_physical-cluster_all-lamps-lit.comfort.C3',(80,628),0),('17_physical-cluster_full.comfort.C4',(1840,628),1),('04_comfort_whole-cluster_mph.comfort.C4',(1840,628),1),('02_three-modes_clean-render.comfort.C4',(1840,628),1)]:
    A,r,u=unwrap(base,*c)
    if flip: u=u[:,::-1][:, np.r_[len(A)-1, 0:len(A)-1]]  # mirror angle a->360-a
    L=u.mean(2)
    print('==',base)
    # bezel: radial profile over 'free' angles 0..120 (no ticks) -> peak
    sel=(A>60)&(A<120)
    prof=np.median(L[:,sel],1)
    i=np.argmax(prof*(r>0.8)); print(' bezel peak r=%.3f val=%.0f'%(r[i],prof[i]), ' halfmax width', r[(prof>prof[i]*0.5)&(r>0.8)][[0,-1]])
    # face level
    print(' face median r0.3-0.55 @60-120:', np.median(L[(r>0.3)&(r<0.55)][:,sel]))
    # tick band angular: max luma over r 0.62..0.86
    band=(r>0.60)&(r<0.88)
    ang=L[band].max(0)
    # find tick peaks
    th=np.percentile(ang[(A>150)&(A<360)],70)*0.6+np.percentile(ang,10)*0.4
    on=ang>max(th,60); 
    segs=[];s=None
    for j,v in enumerate(on):
        if v and s is None: s=j
        if not v and s is not None: segs.append((s,j-1)); s=None
    out=[]
    for s,e in segs:
        a0,a1=A[s],A[e]
        if a1-a0<0.5: continue
        col=L[:, s:e+1].max(1); rr=r[band&(col>0)]
        cb=col*band; mx=cb.max(); rs=r[cb>0.5*mx]
        rgb=u[:, s:e+1][band].reshape(-1,3); 
        bgr=rgb[np.argmax(rgb.sum(1))]
        out.append((round((a0+a1)/2,2), round(a1-a0+0.25,2), round(rs.min(),3), round(rs.max(),3), int(mx), tuple(int(x) for x in bgr[::-1])))
    for o in out: print('  ',o)
    # inner arc: radial profile in 200..330 between r .5 .7
    sel2=(A>205)&(A<330)
    p2=np.median(L[:,sel2],1); m2=(r>0.45)&(r<0.66); i2=np.argmax(p2*m2); print(' inner arc r=%.3f val=%.0f base=%.0f'%(r[i2],p2[i2],np.median(p2[(r>0.4)&(r<0.5)])))
    # inner arc angular extent at that r
    row=L[np.abs(r-r[i2])<0.012].max(0); 
    onA=A[row>np.median(p2[(r>0.4)&(r<0.5)])+0.5*(p2[i2]-np.median(p2[(r>0.4)&(r<0.5)]))]
    print(' inner arc angles min/max', onA.min(), onA.max())
