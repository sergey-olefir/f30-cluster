import cv2, numpy as np, json
exec(open('/Users/solefir/projects/f30-cluster/bake/src/C3/measure/measure.py').read().split('np.set_printoptions')[0])
RECT='/Users/solefir/projects/f30-cluster/bake/work/rect/'
for base,c,flip in [('17_physical-cluster_full.comfort.C3@2x',(80,628),0),('04_comfort_whole-cluster_mph.comfort.C3',(80,628),0),('07_physical-cluster_all-lamps-lit.comfort.C3',(80,628),0),('17_physical-cluster_full.comfort.C4',(1840,628),1),('04_comfort_whole-cluster_mph.comfort.C4',(1840,628),1),('07_physical-cluster_all-lamps-lit.comfort.C4',(1840,628),1),('02_three-modes_clean-render.comfort.C3',(80,628),0)]:
    A,r,u=unwrap(base,*c,dA=1.0)
    if flip: u=u[:,::-1][:, np.r_[len(A)-1, 0:len(A)-1]]
    L=u.mean(2)
    bz=L[(r>0.94)&(r<1.01)].max(0)
    print(base, 'bezel 5deg:', ' '.join('%d'%bz[(A>=a)&(A<a+5)].mean() for a in range(0,360,5)))
    # face colours
    def med(sel): return np.median(u[sel].reshape(-1,3),0)[::-1].astype(int)
    rr=r[:,None]*np.ones_like(A)[None]; aa=np.ones_like(r)[:,None]*A[None]
    print('  face in r<.45 (exc. needle approx):', med((rr<0.45)&(rr>0.2)&((aa<120)|(aa>250))&False | ((rr>0.25)&(rr<0.45)&(aa>60)&(aa<120))),
          ' band .6-.9 @60-120:', med((rr>0.6)&(rr<0.9)&(aa>60)&(aa<120)), ' outside 1.03-1.06 @200-300:', med((rr>1.03)&(aa>200)&(aa<300)),
          ' between ticks .6-.8 @250-260:',med((rr>0.6)&(rr<0.8)&(aa>250)&(aa<256)), ' 0.9 ring @200-300', med((rr>0.89)&(rr<0.92)&(aa>200)&(aa<300)))
    # icon bbox: bright pixels in 0..60 deg, r .55-.95 (fuel convention)
    im=cv2.imread(RECT+base+'.png').astype(np.float32); m=json.load(open(RECT+base+'.json')); k=im.shape[0]/m['box'][3]
    h,w=im.shape[:2]; yy,xx=np.mgrid[0:h,0:w]; X=m['box'][0]+(xx+0.5)/k; Y=m['box'][1]+(yy+0.5)/k
    dx=(X-c[0])*(-1 if flip else 1); dy=Y-c[1]; rad=np.hypot(dx,dy)/70; ang=(np.degrees(np.arctan2(dx,-dy))+360)%360
    Li=im.mean(2); bgv=np.median(Li[(rad<0.5)&(rad>0.3)])
    sel=(ang>0)&(ang<60)&(rad>0.55)&(rad<0.94)&(Li>bgv+0.5*(Li[(ang<60)&(rad>0.55)&(rad<0.94)].max()-bgv))
    if sel.any():
        print('  icon bbox dial-frame (fuel conv) u %.3f..%.3f v %.3f..%.3f'%(dx[sel].min()/70,dx[sel].max()/70,dy[sel].min()/70,dy[sel].max()/70))
