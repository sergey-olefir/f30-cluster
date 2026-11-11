import cv2, numpy as np, json
ref=cv2.imread('scratchpad/ref_comfort.png'); warp=cv2.imread('scratchpad/photo11_panel.png')
H11=np.load('scratchpad/H11.npy'); Hg=np.array(json.load(open('scratchpad/H.json'))['Hm'])
def lum(a): return cv2.cvtColor(a,cv2.COLOR_BGR2GRAY).astype(float)
# 1. the black box: in the grid photo (10.jpg) find the biggest rectangle with no grid lines/labels near (1600,870 photo)
g=cv2.imread('images/10.jpg'); Lg=lum(g)
x0,x1,y0,y1=1430,1800,760,1000
crop=Lg[y0:y1,x0:x1]
lit=(crop>45)
# rows/cols fully dark inside the central band
cx,cy=1600-x0,870-y0
def run(a,c):
    i=c
    while i>0 and not a[i-1]: i-=1
    j=c
    while j<len(a)-1 and not a[j+1]: j+=1
    return i,j
band_x=lit[cy-6:cy+7].any(0)        # any lit pixel in the central rows -> column is not dark
band_y=lit[:,cx-6:cx+7].any(1)
xi,xj=run(band_x,cx); yi,yj=run(band_y,cy)
print('box in grid photo: x %d..%d y %d..%d'%(x0+xi,x0+xj,y0+yi,y0+yj))
Hi=np.linalg.inv(Hg)
def to_panel(H,p):
    v=np.linalg.inv(H)@np.array([p[0],p[1],1.0]); return v[:2]/v[2]
corners=[(x0+xi,y0+yi),(x0+xj,y0+yi),(x0+xj,y0+yj),(x0+xi,y0+yj)]
pp=[to_panel(Hg,c) for c in corners]   # Hg maps panel->photo
print('box panel corners',[tuple(np.round(p).astype(int)) for p in pp])
# 2. what BMW paints over the theme (photo 11 warped to panel vs the bench render)
Lw,Lr=lum(warp),lum(ref)
over=(Lw>90)&(Lr<25)                  # bright in the photo, dark in our render
over=cv2.morphologyEx(over.astype(np.uint8),cv2.MORPH_CLOSE,np.ones((9,9),np.uint8))
n,lab,st,cen=cv2.connectedComponentsWithStats(over)
rows=[]
for i in range(1,n):
    x,y,w,h,a=st[i]
    if a>150: rows.append((int(x),int(y),int(w),int(h),int(a)))
rows.sort(key=lambda r:-r[4])
print('overlay blobs (x,y,w,h,area):'); [print(' ',r) for r in rows[:14]]
# 3. hidden by BMW: bright in our render, dark in the photo
hid=(Lr>110)&(Lw<22)
hid=cv2.morphologyEx(hid.astype(np.uint8),cv2.MORPH_CLOSE,np.ones((15,15),np.uint8))
n,lab,st,cen=cv2.connectedComponentsWithStats(hid)
rows=[(int(st[i][0]),int(st[i][1]),int(st[i][2]),int(st[i][3]),int(st[i][4])) for i in range(1,n) if st[i][4]>1500]
rows.sort(key=lambda r:-r[4]); print('hidden regions:'); [print(' ',r) for r in rows[:8]]
