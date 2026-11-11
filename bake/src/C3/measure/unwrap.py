import cv2, numpy as np, json, sys
R=70.0
def unwrap(base, cx, cy, flip=False):
    im=cv2.imread(base+'.png'); m=json.load(open(base+'.json'))
    x0,y0=m['box'][0],m['box'][1]; k=im.shape[0]/m['box'][3]
    A=np.arange(0,360,0.5); r=np.linspace(0,1.06,240)
    aa,rr=np.meshgrid(A,r)
    a=np.radians(aa)
    px=((cx+rr*R*np.sin(a))-x0)*k-0.5; py=((cy-rr*R*np.cos(a))-y0)*k-0.5
    return cv2.remap(im,px.astype(np.float32),py.astype(np.float32),cv2.INTER_LINEAR)
rows=[]
for b,c in [('17_physical-cluster_full.comfort.C3@2x',(80,628)),('04_comfort_whole-cluster_mph.comfort.C3',(80,628)),('02_three-modes_clean-render.comfort.C3',(80,628)),('17_physical-cluster_full.comfort.C4',(1840,628)),('04_comfort_whole-cluster_mph.comfort.C4',(1840,628)),('02_three-modes_clean-render.comfort.C4',(1840,628))]:
    u=unwrap('/Users/solefir/projects/f30-cluster/bake/work/rect/'+b,*c)
    u=u[::-1]  # r outward up
    for g in range(0,720,60): u[:,g]=(0,90,0)
    rows.append(u); np.save('/Users/solefir/projects/f30-cluster/bake/work/C3/unw_'+b+'.npy',u)
cv2.imwrite('/Users/solefir/projects/f30-cluster/bake/work/C3/unwrap.png',np.vstack(rows))
